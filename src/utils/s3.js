import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'fs';
import fs from 'fs/promises';

const S3_PREFIX = 's3://';

let client;

function env(name) {
  return (process.env[name] || '').trim();
}

/** True when Supabase/S3 credentials are fully set. */
export function s3Configured() {
  return Boolean(
    env('S3_ENDPOINT') &&
      env('S3_REGION') &&
      env('S3_ACCESS_KEY_ID') &&
      env('S3_SECRET_ACCESS_KEY') &&
      env('S3_BUCKET')
  );
}

export function s3Bucket() {
  return env('S3_BUCKET');
}

/**
 * Public HTTPS URL for a key in the configured bucket (Supabase Storage).
 * Prefer S3_PUBLIC_BASE_URL; otherwise derive from Supabase S3 endpoint.
 */
export function s3PublicUrlForKey(key) {
  const cleanKey = key.replace(/^\/+/, '');
  const explicit = env('S3_PUBLIC_BASE_URL');
  if (explicit) {
    return `${explicit.replace(/\/$/, '')}/${cleanKey}`;
  }

  const endpoint = env('S3_ENDPOINT');
  const supabase = endpoint.match(/^https:\/\/([a-z0-9-]+)\.storage\.supabase\.co/i);
  if (supabase) {
    return `https://${supabase[1]}.supabase.co/storage/v1/object/public/${s3Bucket()}/${cleanKey}`;
  }

  if (endpoint) {
    return `${endpoint.replace(/\/$/, '')}/${s3Bucket()}/${cleanKey}`;
  }

  return null;
}

export function publicUrlFromStorageRef(storagePath) {
  const ref = parseStorageRef(storagePath);
  if (!ref) return null;
  return s3PublicUrlForKey(ref.key);
}

/** HTTPS logo URL stored on the client, or derived from the S3 object key. */
export function resolveStoredLogoUrl(org) {
  const stored = typeof org?.logoUrl === 'string' ? org.logoUrl.trim() : '';
  if (stored.startsWith('https://') || stored.startsWith('http://')) return stored;
  if (org?.logoStoragePath) return publicUrlFromStorageRef(org.logoStoragePath);
  return null;
}

function getClient() {
  if (!s3Configured()) {
    throw new Error('S3 is not configured (set S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET)');
  }
  if (!client) {
    const forcePathStyle = env('S3_FORCE_PATH_STYLE') !== 'false';
    client = new S3Client({
      endpoint: env('S3_ENDPOINT'),
      region: env('S3_REGION'),
      credentials: {
        accessKeyId: env('S3_ACCESS_KEY_ID'),
        secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
      },
      forcePathStyle,
      // AWS SDK v3.729+ adds CRC32 checksums to every upload. Supabase Storage
      // rejects those and replies with non-XML, which the SDK reports as a parse error.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return client;
}

export function toStorageRef(key) {
  return `${S3_PREFIX}${s3Bucket()}/${key.replace(/^\/+/, '')}`;
}

export function parseStorageRef(storagePath) {
  if (!storagePath || typeof storagePath !== 'string') return null;
  if (!storagePath.startsWith(S3_PREFIX)) return null;
  const rest = storagePath.slice(S3_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  return {
    bucket: rest.slice(0, slash),
    key: rest.slice(slash + 1),
  };
}

export function isS3StoragePath(storagePath) {
  return Boolean(parseStorageRef(storagePath));
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readErrorBody(err) {
  const body = err?.$response?.body;
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (typeof body.transformToString === 'function') {
    try {
      return await body.transformToString();
    } catch {
      return '';
    }
  }
  try {
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  } catch {
    return '';
  }
}

async function explainS3Failure(err) {
  const text = (await readErrorBody(err)).replace(/\s+/g, ' ').trim();
  if (text) {
    const rawStatus = err?.$metadata?.httpStatusCode || err?.$response?.statusCode || 502;
    const error = new Error(text.slice(0, 300));
    error.statusCode = rawStatus >= 400 && rawStatus < 500 ? rawStatus : 503;
    throw error;
  }
  throw err;
}

/** Upload a local file to S3; returns storage ref `s3://bucket/key`. */
export async function uploadFileToS3(localPath, key, contentType = 'application/octet-stream') {
  const Body = createReadStream(localPath);
  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: s3Bucket(),
        Key: key.replace(/^\/+/, ''),
        Body,
        ContentType: contentType || 'application/octet-stream',
      })
    );
  } catch (err) {
    await explainS3Failure(err);
  }
  return toStorageRef(key);
}

/** Upload a buffer to S3; returns storage ref `s3://bucket/key`. */
export async function uploadBufferToS3(buffer, key, contentType = 'application/octet-stream') {
  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: s3Bucket(),
        Key: key.replace(/^\/+/, ''),
        Body: buffer,
        ContentType: contentType || 'application/octet-stream',
      })
    );
  } catch (err) {
    await explainS3Failure(err);
  }
  return toStorageRef(key);
}

export async function downloadS3ToBuffer(storagePath) {
  const ref = parseStorageRef(storagePath);
  if (!ref) throw new Error('Not an S3 storage path');
  const out = await getClient().send(
    new GetObjectCommand({
      Bucket: ref.bucket,
      Key: ref.key,
    })
  );
  return streamToBuffer(out.Body);
}

export async function deleteS3Object(storagePath) {
  const ref = parseStorageRef(storagePath);
  if (!ref) return;
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: ref.bucket,
      Key: ref.key,
    })
  );
}

/** Read bytes from either an S3 ref or a local filesystem path. */
export async function readStorageBytes(storagePath) {
  if (isS3StoragePath(storagePath)) {
    return downloadS3ToBuffer(storagePath);
  }
  return fs.readFile(storagePath);
}
