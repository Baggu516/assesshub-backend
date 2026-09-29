import { cacheGet, cacheSet, parseDurationToSeconds } from '../utils/redisCache.js';
import { userRevokedAtKey } from './keys.js';

function accessTokenTtlSeconds() {
  return parseDurationToSeconds(process.env.JWT_ACCESS_EXPIRES_IN, 900);
}

/** Mark all access tokens for this user issued before now as invalid. */
export async function revokeUserAccessTokens(userId) {
  if (!userId) return;
  const ttl = accessTokenTtlSeconds() + 60;
  await cacheSet(userRevokedAtKey(userId), Date.now(), ttl);
}

/**
 * @param {{ sub?: string, iat?: number }} payload
 * @returns {Promise<boolean>} true if token should be rejected
 */
export async function isAccessTokenRevoked(payload) {
  if (!payload?.sub || !payload?.iat) return false;
  const revokedAt = await cacheGet(userRevokedAtKey(payload.sub));
  if (revokedAt == null) return false;
  const ms = Number(revokedAt);
  if (!Number.isFinite(ms)) return false;
  return payload.iat * 1000 < ms;
}
