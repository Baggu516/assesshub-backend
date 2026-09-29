import { getRedis } from '../config/redis.js';
import { cacheDel, cacheGet, cacheSet } from '../utils/redisCache.js';
import { DASH_TTL_SECONDS, dashKey } from './keys.js';

export async function getCachedDashboard(orgId, userId, academicYearId) {
  return cacheGet(dashKey(orgId, userId, academicYearId));
}

export async function setCachedDashboard(orgId, userId, academicYearId, payload) {
  await cacheSet(dashKey(orgId, userId, academicYearId), payload, DASH_TTL_SECONDS);
}

/**
 * Drop all dashboard snapshots for an org (submit / publish / assign).
 * SCAN is fine at free-tier scale; keys are short-TTL anyway.
 */
export async function invalidateDashboardForOrg(orgId) {
  const redis = getRedis();
  if (!redis) return;

  const match = `dash:${orgId}:*`;
  try {
    let cursor = 0;
    do {
      const [next, keys] = await redis.scan(cursor, { match, count: 100 });
      cursor = Number(next);
      if (keys?.length) await cacheDel(...keys);
    } while (cursor !== 0);
  } catch {
    /* ignore */
  }
}
