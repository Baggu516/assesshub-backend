import crypto from 'crypto';

/**
 * Normalize a registration ID prefix (letters/digits only, uppercase).
 * e.g. "viswam" → "VISWAM", "my-school" → "MYSCHOOL"
 */
export function registrationIdPrefix(raw) {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  return cleaned || 'ORG';
}

/**
 * Prefer org.registrationPrefix (school register ID string); fall back to subdomain.
 */
export function orgRegistrationPrefix(org) {
  return registrationIdPrefix(org?.registrationPrefix || org?.subdomain);
}

function randomFiveDigits() {
  return String(crypto.randomInt(10000, 100000));
}

/**
 * Generate a unique registration ID for an org: PREFIX + 5 digits, all caps.
 * `prefixSource` is typically org.registrationPrefix || org.subdomain.
 * Retries on collision.
 */
export async function allocateRegistrationId(User, orgId, prefixSource, { maxAttempts = 20 } = {}) {
  const prefix = registrationIdPrefix(prefixSource);

  for (let i = 0; i < maxAttempts; i += 1) {
    const registrationId = `${prefix}${randomFiveDigits()}`;
    const exists = await User.exists({ orgId, registrationId });
    if (!exists) return registrationId;
  }

  const err = new Error('Could not allocate a unique registration ID');
  err.status = 500;
  throw err;
}

/** Ensure user has a registrationId; generates and saves if missing. */
export async function ensureUserRegistrationId(user, User, prefixSource) {
  if (user.registrationId) return String(user.registrationId).toUpperCase();
  const registrationId = await allocateRegistrationId(User, user.orgId, prefixSource);
  user.registrationId = registrationId;
  await user.save();
  return registrationId;
}
