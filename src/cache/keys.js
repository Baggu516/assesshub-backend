export const ORG_TTL_SECONDS = 90;
export const DASH_TTL_SECONDS = 30;
export const ACADEMIC_YEAR_TTL_SECONDS = 180;

export function orgSubKey(subdomain) {
  return `org:sub:${String(subdomain || '').toLowerCase()}`;
}

export function orgIdKey(orgId) {
  return `org:id:${String(orgId)}`;
}

export function dashKey(orgId, userId, academicYearId) {
  return `dash:${orgId}:${userId}:${academicYearId || 'current'}`;
}

export function dashOrgPrefix(orgId) {
  return `dash:${orgId}:`;
}

export function ayListKey(orgId) {
  return `ay:${orgId}:list`;
}

export function catalogVersionKey(subdomain) {
  return `catalog:v:${String(subdomain || '').toLowerCase()}`;
}

export function userRevokedAtKey(userId) {
  return `user:revokedAt:${userId}`;
}
