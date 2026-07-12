import jwt from 'jsonwebtoken';

export function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
  });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
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
    expiresIn: process.env.PLATFORM_ADMIN_TOKEN_EXPIRES_IN,
  });
}

export function verifyPlatformToken(token) {
  return jwt.verify(token, process.env.PLATFORM_ADMIN_JWT_SECRET);
}

export function platformTokenExpiresIn() {
  return process.env.PLATFORM_ADMIN_TOKEN_EXPIRES_IN;
}
