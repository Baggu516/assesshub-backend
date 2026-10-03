import { verifyAccessToken } from '../utils/jwt.js';
import { isAccessTokenRevoked } from '../cache/tokenRevocation.js';
import { describeAccess, stampStudentTrial } from '../modules/billing/access.js';

function openWhenSubscriptionLocked(req) {
  const path = req.originalUrl || req.url || '';
  return path.startsWith('/api/auth') || path.startsWith('/api/billing');
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = header.slice(7);
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired access token' });
    }

    if (await isAccessTokenRevoked(payload)) {
      return res.status(401).json({ error: 'Access token has been revoked' });
    }

    if (!req.tenantModels) {
      return res.status(500).json({ error: 'Server misconfiguration: tenant context required' });
    }

    if (payload.subdomain && req.tenant && payload.subdomain !== req.tenant.subdomain) {
      return res.status(403).json({ error: 'Access token is for a different organization' });
    }

    const user = await req.tenantModels.User.findById(payload.sub).populate('roleId');

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    if (req.tenant && user.orgId.toString() !== req.tenant.orgId) {
      return res.status(403).json({ error: 'Tenant mismatch for this user' });
    }

    if (stampStudentTrial(user)) await user.save();

    const billingEnabled = req.tenant?.organization?.studentBillingEnabled !== false;
    const access = describeAccess(user, new Date(), { billingEnabled });
    req.studentAccess = access;
    req.user = user;
    req.auth = {
      userId: user._id.toString(),
      orgId: user.orgId.toString(),
      permissions: user.permissions || [],
    };

    if (access.locked && !openWhenSubscriptionLocked(req)) {
      return res.status(402).json({
        error: 'Your free trial has ended. Subscribe to continue.',
        code: 'SUBSCRIPTION_REQUIRED',
        access,
      });
    }

    return next();
  } catch (e) {
    return next(e);
  }
}
