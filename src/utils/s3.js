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

/** Upload a local file to S3; returns storage ref `s3://bucket/key`. */
export async function uploadFileToS3(localPath, key, contentType = 'application/octet-stream') {
  const Body = createReadStream(localPath);
  await getClient().send(
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: key.replace(/^\/+/, ''),
      Body,
      ContentType: contentType || 'application/octet-stream',
    })
  );
  return toStorageRef(key);
}

/** Upload a buffer to S3; returns storage ref `s3://bucket/key`. */
export async function uploadBufferToS3(buffer, key, contentType = 'application/octet-stream') {
  await getClient().send(
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: key.replace(/^\/+/, ''),
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    })
  );
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
