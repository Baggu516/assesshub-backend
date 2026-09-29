import { Organization } from '../models/Organization.js';
import { cacheDel, cacheGet, cacheSet } from '../utils/redisCache.js';
import { ORG_TTL_SECONDS, orgIdKey, orgSubKey } from './keys.js';

function serializeOrg(doc) {
  if (!doc) return null;
  const lean = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  return {
    ...lean,
    _id: String(lean._id),
  };
}

/**
 * Active org by subdomain (tenant middleware). Falls back to Mongo when Redis misses.
 */
export async function getActiveOrgBySubdomain(subdomain) {
  const key = orgSubKey(subdomain);
  const cached = await cacheGet(key);
  if (cached && cached.isActive !== false) {
    return cached;
  }

  const organization = await Organization.findOne({ subdomain, isActive: true }).lean();
  if (!organization) return null;

  const payload = serializeOrg(organization);
  await cacheSet(key, payload, ORG_TTL_SECONDS);
  await cacheSet(orgIdKey(payload._id), { subdomain: payload.subdomain }, ORG_TTL_SECONDS);
  return payload;
}

/** Org by id (features / branding helpers). Does not write partial docs into the subdomain cache. */
export async function getOrgByIdCached(orgId, select) {
  const key = orgIdKey(orgId);
  const meta = await cacheGet(key);
  if (meta?.subdomain) {
    const bySub = await cacheGet(orgSubKey(meta.subdomain));
    if (bySub) return bySub;
  }

  let q = Organization.findById(orgId);
  if (select) q = q.select(select);
  const organization = await q.lean();
  if (!organization) return null;

  const payload = serializeOrg(organization);
  // Only full documents belong in org:sub — selected projections can poison tenant middleware.
  if (!select && payload.isActive !== false) {
    await cacheSet(orgSubKey(payload.subdomain), payload, ORG_TTL_SECONDS);
  }
  if (payload.subdomain) {
    await cacheSet(key, { subdomain: payload.subdomain }, ORG_TTL_SECONDS);
  }
  return payload;
}

/** Public branding may include inactive check separately; cache active + inactive. */
export async function getOrgBySubdomainCached(subdomain) {
  const key = orgSubKey(subdomain);
  const cached = await cacheGet(key);
  if (cached) return cached;

  const organization = await Organization.findOne({ subdomain }).lean();
  if (!organization) return null;

  const payload = serializeOrg(organization);
  await cacheSet(key, payload, ORG_TTL_SECONDS);
  await cacheSet(orgIdKey(payload._id), { subdomain: payload.subdomain }, ORG_TTL_SECONDS);
  return payload;
}

export async function invalidateOrgCache({ subdomain, orgId } = {}) {
  const keys = [];
  let sub = subdomain ? String(subdomain).toLowerCase() : null;
  let id = orgId ? String(orgId) : null;

  if (!sub && id) {
    const meta = await cacheGet(orgIdKey(id));
    if (meta?.subdomain) sub = meta.subdomain;
  }
  if (sub && !id) {
    const org = await cacheGet(orgSubKey(sub));
    if (org?._id) id = String(org._id);
  }

  if (sub) keys.push(orgSubKey(sub));
  if (id) keys.push(orgIdKey(id));
  if (keys.length) await cacheDel(...keys);
}
