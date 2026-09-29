import rateLimit from 'express-rate-limit';
import { verifyAccessToken, verifyPlatformToken } from '../utils/jwt.js';
import { getRedis, redisEnabled } from '../config/redis.js';

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

/**
 * express-rate-limit store backed by Upstash. Falls back to the default
 * memory store when Redis env is missing (local/dev).
 */
function createUpstashStore(prefix) {
  if (!redisEnabled()) return undefined;

  const redis = getRedis();
  let windowMs = 60_000;

  return {
    init(options) {
      windowMs = options.windowMs;
    },
    async increment(key) {
      const redisKey = `${prefix}${key}`;
      const totalHits = await redis.incr(redisKey);
      if (totalHits === 1) {
        await redis.pexpire(redisKey, windowMs);
      }
      let ttl = await redis.pttl(redisKey);
      if (ttl < 0) {
        await redis.pexpire(redisKey, windowMs);
        ttl = windowMs;
      }
      return {
        totalHits,
        resetTime: new Date(Date.now() + Math.max(ttl, 0)),
      };
    },
    async decrement(key) {
      await redis.decr(`${prefix}${key}`);
    },
    async resetKey(key) {
      await redis.del(`${prefix}${key}`);
    },
  };
}

function limiterOptions(extra = {}) {
  const store = createUpstashStore(extra.prefix || 'rl:');
  const { prefix: _prefix, ...rest } = extra;
  return {
    standardHeaders: true,
    legacyHeaders: false,
    ...(store ? { store } : {}),
    ...rest,
  };
}

export const apiLimiter = rateLimit(
  limiterOptions({
    prefix: 'rl:api:',
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900_000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 200,
    keyGenerator: clientKey,
    skip: isProctorCapturePost,
  })
);

/**
 * One snapshot at most every 12s ≈ 75 per 15 minutes.
 * 120 leaves room for retries without letting one student flood storage.
 */
export const captureLimiter = rateLimit(
  limiterOptions({
    prefix: 'rl:capture:',
    windowMs: 15 * 60 * 1000,
    max: 120,
    keyGenerator: (req) => {
      const uid = req.auth?.userId;
      return uid ? `capture:${uid}` : `capture:${req.ip || 'unknown'}`;
    },
    message: { error: 'Too many camera snapshots. Wait a few minutes and continue.' },
  })
);

export const authLimiter = rateLimit(
  limiterOptions({
    prefix: 'rl:auth:',
    windowMs: 15 * 60 * 1000,
    max: 50,
  })
);

export const forgotLimiter = rateLimit(
  limiterOptions({
    prefix: 'rl:forgot:',
    windowMs: 15 * 60 * 1000,
    max: 8,
    message: { error: 'Too many reset attempts. Try again in a few minutes.' },
  })
);

/** AI proxy: tighter cap, keyed by user after auth. */
export const aiLimiter = rateLimit(
  limiterOptions({
    prefix: 'rl:ai:',
    windowMs: 15 * 60 * 1000,
    max: 40,
    keyGenerator: (req) => {
      const uid = req.auth?.userId;
      return uid ? `ai:${uid}` : `ai:${req.ip}`;
    },
  })
);
