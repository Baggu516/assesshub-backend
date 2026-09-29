import { getRedis } from '../config/redis.js';

/** @param {string} key */
export async function cacheGet(key) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {number} ttlSeconds
 */
export async function cacheSet(key, value, ttlSeconds) {
  const redis = getRedis();
  if (!redis) return false;
  try {
    if (ttlSeconds > 0) {
      await redis.set(key, value, { ex: ttlSeconds });
    } else {
      await redis.set(key, value);
    }
    return true;
  } catch {
    return false;
  }
}

/** @param {...string} keys */
export async function cacheDel(...keys) {
  const redis = getRedis();
  if (!redis || !keys.length) return;
  try {
    await redis.del(...keys);
  } catch {
    /* ignore */
  }
}

/**
 * Parse access-token lifetime (e.g. 15m, 1h) to seconds for revocation TTLs.
 * @param {string | undefined} raw
 * @param {number} fallbackSeconds
 */
export function parseDurationToSeconds(raw, fallbackSeconds = 900) {
  const value = String(raw || '').trim();
  if (!value) return fallbackSeconds;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  const match = value.match(/^(\d+)\s*([smhd])$/i);
  if (!match) return fallbackSeconds;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === 's') return n;
  if (unit === 'm') return n * 60;
  if (unit === 'h') return n * 3600;
  if (unit === 'd') return n * 86400;
  return fallbackSeconds;
}
