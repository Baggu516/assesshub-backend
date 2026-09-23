import crypto from 'crypto';

/**
 * Build registration ID prefix from org subdomain/domain.
 * e.g. "viswam" → "VISWAM", "my-school" → "MYSCHOOL"
 */
export function registrationIdPrefix(subdomain) {
  const cleaned = String(subdomain || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  return cleaned || 'ORG';
}

function randomFiveDigits() {
  return String(crypto.randomInt(10000, 100000));
}

/**
 * Generate a unique registration ID for an org: DOMAIN + 5 digits, all caps.
 * Retries on collision.
 */
export async function allocateRegistrationId(User, orgId, subdomain, { maxAttempts = 20 } = {}) {
  const prefix = registrationIdPrefix(subdomain);

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
export async function ensureUserRegistrationId(user, User, subdomain) {
  if (user.registrationId) return String(user.registrationId).toUpperCase();
  const registrationId = await allocateRegistrationId(User, user.orgId, subdomain);
  user.registrationId = registrationId;
  await user.save();
  return registrationId;
}
