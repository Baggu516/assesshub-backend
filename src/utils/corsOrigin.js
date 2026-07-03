/** Comma-separated origins; `*` in host matches one subdomain label (e.g. `https://*.vercel.app`). */
export function parseCorsOrigins(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

export function isCorsOriginAllowed(origin, allowed) {
  if (!origin) return true;
  if (allowed.includes(origin)) return true;
  return allowed.some((pattern) => pattern.includes('*') && patternToRegExp(pattern).test(origin));
}

export function createCorsOriginChecker(allowedOrigins) {
  return (origin, callback) => {
    if (isCorsOriginAllowed(origin, allowedOrigins)) {
      callback(null, origin || true);
      return;
    }
    callback(new Error(`CORS blocked origin: ${origin}`));
  };
}
