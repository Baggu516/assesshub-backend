import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';

function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function isPlatformPasswordLoginConfigured() {
  return !!(
    env.PLATFORM_ADMIN_EMAIL?.trim() &&
    (env.PLATFORM_ADMIN_PASSWORD || env.PLATFORM_ADMIN_PASSWORD_HASH)
  );
}

/** Returns true when email matches and password is correct (bcrypt hash or plain env password). */
export function validatePlatformCredentials(email, password) {
  const expectedEmail = env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  if (!expectedEmail || email == null || password == null) return false;
  if (String(email).trim().toLowerCase() !== expectedEmail) return false;

  if (env.PLATFORM_ADMIN_PASSWORD_HASH) {
    return bcrypt.compareSync(String(password), env.PLATFORM_ADMIN_PASSWORD_HASH);
  }
  if (env.PLATFORM_ADMIN_PASSWORD) {
    return timingSafeEqualString(String(password), env.PLATFORM_ADMIN_PASSWORD);
  }
  return false;
}
