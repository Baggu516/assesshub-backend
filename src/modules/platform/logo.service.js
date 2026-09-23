import crypto from 'crypto';
import path from 'path';
import { AppError } from '../../utils/errors.js';
import {
  deleteS3Object,
  s3Configured,
  s3PublicUrlForKey,
  uploadBufferToS3,
} from '../../utils/s3.js';

function extForFile(file) {
  const fromName = path.extname(file.originalname || '').toLowerCase();
  if (fromName) return fromName;
  const mime = (file.mimetype || '').toLowerCase();
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/svg+xml') return '.svg';
  return '.png';
}

/**
 * Upload a client logo to Supabase (S3). Returns { logoUrl, logoStoragePath }.
 */
export async function uploadClientLogo(file, subdomain) {
  if (!file?.buffer?.length) {
    throw new AppError('Logo file is empty', 400);
  }
  if (!s3Configured()) {
    throw new AppError(
      'Logo storage is not configured. Set Supabase S3 env (S3_ENDPOINT, S3_BUCKET, keys).',
      503
    );
  }

  const sub = String(subdomain || 'client')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 63) || 'client';
  const key = `logos/${sub}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extForFile(file)}`;
  const logoStoragePath = await uploadBufferToS3(file.buffer, key, file.mimetype || 'application/octet-stream');
  const logoUrl = s3PublicUrlForKey(key);
  if (!logoUrl) {
    throw new AppError('Could not build public logo URL', 500);
  }
  return { logoUrl, logoStoragePath };
}

export async function replaceClientLogo(org, file) {
  const previous = org.logoStoragePath;
  const next = await uploadClientLogo(file, org.subdomain);
  org.logoUrl = next.logoUrl;
  org.logoStoragePath = next.logoStoragePath;
  if (previous && previous !== next.logoStoragePath) {
    try {
      await deleteS3Object(previous);
    } catch {
      /* ignore cleanup errors */
    }
  }
  return next;
}

export async function clearClientLogo(org) {
  const previous = org.logoStoragePath;
  org.logoUrl = undefined;
  org.logoStoragePath = undefined;
  if (previous) {
    try {
      await deleteS3Object(previous);
    } catch {
      /* ignore */
    }
  }
}
