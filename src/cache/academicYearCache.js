import { cacheDel, cacheGet, cacheSet } from '../utils/redisCache.js';
import { ACADEMIC_YEAR_TTL_SECONDS, ayListKey } from './keys.js';

export async function getCachedAcademicYearList(orgId) {
  return cacheGet(ayListKey(orgId));
}

export async function setCachedAcademicYearList(orgId, payload) {
  await cacheSet(ayListKey(orgId), payload, ACADEMIC_YEAR_TTL_SECONDS);
}

export async function invalidateAcademicYearCache(orgId) {
  await cacheDel(ayListKey(orgId));
}
