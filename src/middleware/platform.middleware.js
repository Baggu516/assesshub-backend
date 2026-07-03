import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function isPlatformApiConfigured() {
  const hasKey = !!env.PLATFORM_ADMIN_API_KEY;
  const hasPasswordLogin =
    !!env.PLATFORM_ADMIN_EMAIL?.trim() &&
    !!(env.PLATFORM_ADMIN_PASSWORD || env.PLATFORM_ADMIN_PASSWORD_HASH);
  return hasKey || hasPasswordLogin;
}

/**
 * Accepts `Authorization: Bearer <platform JWT>` (after `/platform/login`),
 * or legacy `X-Platform-Key` when `PLATFORM_ADMIN_API_KEY` is set.
 * Bearer is validated before the “not configured” check so DB-backed platform users work after login.
 */
export function platformAuthMiddleware(req, res, next) {
  const bearer =
    req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;

  if (bearer) {
    try {
      const payload = jwt.verify(bearer, env.PLATFORM_ADMIN_JWT_SECRET);
      if (!payload.platform) {
        return res.status(401).json({ error: 'Invalid platform session' });
      }
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired platform session' });
    }
  }

  if (env.PLATFORM_ADMIN_API_KEY) {
    const key = req.headers['x-platform-key'];
    if (key && typeof key === 'string' && timingSafeEqualString(key.trim(), env.PLATFORM_ADMIN_API_KEY)) {
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
