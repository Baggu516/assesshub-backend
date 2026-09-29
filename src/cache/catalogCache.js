import { getRedis } from '../config/redis.js';
import { cacheGet, cacheSet } from '../utils/redisCache.js';
import { catalogVersionKey } from './keys.js';

/** Cross-instance catalog sync flag (mirrors in-process Map). */
export async function getCatalogVersion(subdomain) {
  const v = await cacheGet(catalogVersionKey(subdomain));
  if (v == null) return null;
  return Number(v);
}

export async function setCatalogVersion(subdomain, version) {
  // Long TTL — version bump in code forces re-sync even if key still present.
  await cacheSet(catalogVersionKey(subdomain), version, 60 * 60 * 24 * 30);
}

export async function catalogVersionMatches(subdomain, version) {
  const redis = getRedis();
  if (!redis) return null;
  const current = await getCatalogVersion(subdomain);
  return current === version;
}
