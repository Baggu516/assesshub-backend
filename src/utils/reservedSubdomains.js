/** Subdomains that cannot be used for client organizations. */
export const RESERVED_SUBDOMAINS = new Set([
  'master',
  'www',
  'api',
  'app',
  'admin',
  'platform',
  'mail',
  'smtp',
  'ftp',
  'cdn',
  'static',
  'assets',
]);

export function isReservedSubdomain(subdomain) {
  const s = String(subdomain || '')
    .trim()
    .toLowerCase();
  return !s || RESERVED_SUBDOMAINS.has(s);
}

/** True when host is the master console (plain localhost / master.*). */
export function isMasterHost(hostname) {
  const host = String(hostname || '')
    .split(':')[0]
    .toLowerCase();
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  if (host === 'master.localhost' || host.startsWith('master.')) return true;
  const base = (process.env.BASE_DOMAIN || '').toLowerCase();
  if (base && (host === `master.${base}` || host === base || host === `www.${base}`)) return true;
  return false;
}
