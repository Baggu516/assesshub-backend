import { Redis } from '@upstash/redis';

/** @type {import('@upstash/redis').Redis | null} */
let client = null;
let initialized = false;

/** True when Upstash REST URL + token are set (optional in local/dev). */
export function redisEnabled() {
  return Boolean(
    String(process.env.UPSTASH_REDIS_REST_URL || '').trim() &&
      String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
  );
}

/**
 * Shared Upstash Redis client, or null when Redis env is missing.
 * Safe to call on every request; constructs the client once.
 */
export function getRedis() {
  if (!redisEnabled()) return null;
  if (!initialized) {
    client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL.trim(),
      token: process.env.UPSTASH_REDIS_REST_TOKEN.trim(),
    });
    initialized = true;
  }
  return client;
}
