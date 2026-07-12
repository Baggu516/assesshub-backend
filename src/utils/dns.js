import dns from 'dns';

/**
 * Some home routers (e.g. 192.168.0.1) refuse Node's DNS queries (querySrv ECONNREFUSED)
 * even when Atlas Network Access allows all IPs. Prefer public resolvers locally.
 *
 * Override with DNS_SERVERS=8.8.8.8,1.1.1.1 or leave unset to use OS defaults in production.
 */
export function configureDns() {
  const fromEnv = (process.env.DNS_SERVERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (fromEnv.length) {
    dns.setServers(fromEnv);
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }
}
