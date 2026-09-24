import { timingSafeEqualString } from '../utils/secureCompare.js';
import { verifyAccessToken, verifyPlatformToken } from '../utils/jwt.js';
import { getTenantModels } from '../db/tenantModels.js';
import { Organization } from '../models/Organization.js';

export function isPlatformApiConfigured() {
  // Client management is always available to master-tenant admins.
  return true;
}

async function acceptMasterTenantBearer(bearer) {
  let payload;
  try {
    payload = verifyAccessToken(bearer);
  } catch {
    return null;
  }
  if (payload?.subdomain !== 'master' || !payload?.sub) return null;

  const org = await Organization.findOne({ subdomain: 'master', isActive: { $ne: false } }).lean();
  if (!org) return null;

  const { User } = await getTenantModels('master');
  const user = await User.findById(payload.sub).lean();
  if (!user || !user.isActive) return null;
  if (String(user.orgId) !== String(org._id)) return null;
  if (user.hierarchyRole !== 'admin') return null;

  return { user, org, payload };
}

/**
 * Accepts:
 * - Authorization: Bearer <platform JWT>
 * - Authorization: Bearer <master tenant admin JWT>
 * - legacy X-Platform-Key
 */
export async function platformAuthMiddleware(req, res, next) {
  const bearer =
    req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;

  if (bearer) {
    try {
      const payload = verifyPlatformToken(bearer);
      if (payload.platform) {
        req.platformAuth = { type: 'platform' };
        return next();
      }
    } catch {
      /* try master tenant token next */
    }

    try {
      const master = await acceptMasterTenantBearer(bearer);
      if (master) {
        req.platformAuth = { type: 'master-tenant', userId: master.user._id.toString() };
        return next();
      }
    } catch (err) {
      return next(err);
    }

    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  if (process.env.PLATFORM_ADMIN_API_KEY) {
    const key = req.headers['x-platform-key'];
    if (
      key &&
      typeof key === 'string' &&
      timingSafeEqualString(key.trim(), process.env.PLATFORM_ADMIN_API_KEY)
    ) {
      req.platformAuth = { type: 'api-key' };
      return next();
    }
  }

  return res.status(401).json({ error: 'Sign in as master admin to manage clients' });
}
