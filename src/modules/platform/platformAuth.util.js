import bcrypt from 'bcryptjs';
import { timingSafeEqualString } from '../../utils/secureCompare.js';

export function isPlatformPasswordLoginConfigured() {
  return !!(
    process.env.PLATFORM_ADMIN_EMAIL?.trim() &&
    (process.env.PLATFORM_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD_HASH)
  );
}

/** Returns true when email matches and password is correct (bcrypt hash or plain env password). */
export function validatePlatformCredentials(email, password) {
  const expectedEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  if (!expectedEmail || email == null || password == null) return false;
  if (String(email).trim().toLowerCase() !== expectedEmail) return false;

  if (process.env.PLATFORM_ADMIN_PASSWORD_HASH) {
    return bcrypt.compareSync(String(password), process.env.PLATFORM_ADMIN_PASSWORD_HASH);
  }
  if (process.env.PLATFORM_ADMIN_PASSWORD) {
    return timingSafeEqualString(String(password), process.env.PLATFORM_ADMIN_PASSWORD);
  }
  return false;
}
