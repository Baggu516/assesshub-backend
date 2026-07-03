import { env } from '../config/env.js';

/**
 * Resolves tenant subdomain from Host header or X-Tenant-Subdomain (dev / proxies).
 * Plain localhost with env DEFAULT_TENANT_SUBDOMAIN falls back to that org (no URL subdomain).
 */
export function resolveSubdomainFromRequest(req) {
  const headerTenant = req.headers['x-tenant-subdomain'];
  if (headerTenant && typeof headerTenant === 'string') {
    return headerTenant.trim().toLowerCase();
  }

  const host = req.headers.host || '';
  const base = env.BASE_DOMAIN.toLowerCase();

  // Strip port
  const hostname = host.split(':')[0].toLowerCase();

  let subdomain = null;

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    const parts = hostname.split('.');
    if (parts.length >= 2 && parts[0] !== 'www') {
      subdomain = parts[0];
    }
  } else if (hostname.endsWith(base) && hostname !== base && hostname !== `www.${base}`) {
    const sub = hostname.replace(`.${base}`, '').replace(/^www\./, '');
    if (sub && sub !== hostname) subdomain = sub.split('.')[0];
  }

  const plainLocal =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

  if (subdomain == null && plainLocal) {
    const def = env.DEFAULT_TENANT_SUBDOMAIN.trim().toLowerCase();
    if (def) return def;
  }

  return subdomain;
}
