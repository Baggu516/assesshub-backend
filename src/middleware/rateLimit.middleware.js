import rateLimit from 'express-rate-limit';
import { verifyAccessToken, verifyPlatformToken } from '../utils/jwt.js';

/**
 * Logged-in calls are counted per user, so a school Wi-Fi (one public IP)
 * does not share a single bucket. Anonymous calls stay per IP.
 */
function clientKey(req) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) {
    try {
      const payload = verifyAccessToken(token);
      if (payload?.sub) return `user:${payload.sub}`;
    } catch {
      /* not a tenant access token */
    }
    if (process.env.PLATFORM_ADMIN_JWT_SECRET) {
      try {
        const payload = verifyPlatformToken(token);
        if (payload?.platform) return 'platform-admin';
      } catch {
        /* anonymous */
      }
    }
  }
  return req.ip || 'unknown';
}

/** Camera uploads are limited on their own route, after auth. */
function isProctorCapturePost(req) {
  if (req.method !== 'POST') return false;
  const path = (req.originalUrl || req.url || '').split('?')[0];
  return /\/assessments\/assignments\/[^/]+\/captures\/?$/.test(path);
}

export const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10),
  max: parseInt(process.env.RATE_LIMIT_MAX, 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  skip: isProctorCapturePost,
});

/**
 * One snapshot at most every 12s ≈ 75 per 15 minutes.
 * 120 leaves room for retries without letting one student flood storage.
 */
export const captureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = req.auth?.userId;
    return uid ? `capture:${uid}` : `capture:${req.ip || 'unknown'}`;
  },
  message: { error: 'Too many camera snapshots. Wait a few minutes and continue.' },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

export const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset attempts. Try again in a few minutes.' },
});

/** AI proxy: tighter cap, keyed by user after auth. */
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = req.auth?.userId;
    return uid ? `ai:${uid}` : `ai:${req.ip}`;
  },
});
