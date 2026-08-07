import jwt from 'jsonwebtoken';

/** jsonwebtoken accepts seconds (number) or strings like 15m, 8h, 7d — not empty/blank. */
function expiresInOrDefault(value, fallback) {
  const raw = value == null ? '' : String(value).trim();
  return raw || fallback;
}

export function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: expiresInOrDefault(process.env.JWT_ACCESS_EXPIRES_IN, '15m'),
  });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: expiresInOrDefault(process.env.JWT_REFRESH_EXPIRES_IN, '7d'),
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

/** Platform (super-admin) session JWT — separate secret from tenant tokens. */
export function signPlatformToken(payload = { platform: true }) {
  return jwt.sign(payload, process.env.PLATFORM_ADMIN_JWT_SECRET, {
    expiresIn: expiresInOrDefault(process.env.PLATFORM_ADMIN_TOKEN_EXPIRES_IN, '8h'),
  });
}

export function verifyPlatformToken(token) {
  return jwt.verify(token, process.env.PLATFORM_ADMIN_JWT_SECRET);
}

export function platformTokenExpiresIn() {
  return expiresInOrDefault(process.env.PLATFORM_ADMIN_TOKEN_EXPIRES_IN, '8h');
}
