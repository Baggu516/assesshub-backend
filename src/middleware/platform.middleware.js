import { timingSafeEqualString } from '../utils/secureCompare.js';
import { verifyPlatformToken } from '../utils/jwt.js';

export function isPlatformApiConfigured() {
  const hasKey = !!process.env.PLATFORM_ADMIN_API_KEY;
  const hasPasswordLogin =
    !!process.env.PLATFORM_ADMIN_EMAIL?.trim() &&
    !!(process.env.PLATFORM_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD_HASH);
  return hasKey || hasPasswordLogin;
}

/**
 * Accepts `Authorization: Bearer <platform JWT>` (after `/platform/login`),
 * or legacy `X-Platform-Key` when `PLATFORM_ADMIN_API_KEY` is set.
 */
export function platformAuthMiddleware(req, res, next) {
  const bearer =
    req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;

  if (bearer) {
    try {
      const payload = verifyPlatformToken(bearer);
      if (!payload.platform) {
        return res.status(401).json({ error: 'Invalid platform session' });
      }
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired platform session' });
    }
  }

  if (process.env.PLATFORM_ADMIN_API_KEY) {
    const key = req.headers['x-platform-key'];
    if (
      key &&
      typeof key === 'string' &&
      timingSafeEqualString(key.trim(), process.env.PLATFORM_ADMIN_API_KEY)
    ) {
      return next();
    }
  }

  if (!isPlatformApiConfigured()) {
    return res.status(503).json({
      error:
        'Platform administration is not configured. Set PLATFORM_ADMIN_EMAIL + PLATFORM_ADMIN_PASSWORD (or hash), and/or PLATFORM_ADMIN_API_KEY.',
    });
  }

  return res.status(401).json({ error: 'Sign in or provide X-Platform-Key' });
}
