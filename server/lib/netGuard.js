// Is a host name or address one this server must not be told to call?
//
// Outbound calls whose target a user can set (the SMTP server, a hub peer's
// URL) must not reach the inside of the deployment: the database, the other
// tenants' containers on the same Docker network, the cloud metadata service.
// This is a name/literal check, made where the target is saved and again where
// it is used. It does not resolve DNS - a public name that resolves to a
// private address is out of its reach, which is why the platform network
// itself is also split per tenant.
import net from 'node:net';

const V4_PRIVATE = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const v4ToInt = (ip) => ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
const inV4Range = (ip, [base, bits]) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
};

export function isInternalHost(rawHost) {
  let host = String(rawHost || '').trim().toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) return true;
  // Docker service names and other single-label names (mongo, api, caddy...).
  if (!host.includes('.') && !host.includes(':')) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return true;
  // Numeric forms some resolvers accept for an address: 2130706433, 0x7f000001, 017700000001.
  if (/^(0x[0-9a-f]+|\d+)$/.test(host)) return true;
  const kind = net.isIP(host);
  if (kind === 4) return V4_PRIVATE.some((r) => inV4Range(host, r));
  if (kind === 6) {
    if (host === '::' || host === '::1') return true;
    if (/^(fc|fd|fe8|fe9|fea|feb)/.test(host)) return true;              // unique-local, link-local
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    if (mapped) return isInternalHost(mapped[1]);
    return false;
  }
  return false;
}

// The same check for a URL: refuses non-http(s) schemes and internal hosts.
export function isInternalUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch { return true; }
  if (!['http:', 'https:'].includes(u.protocol)) return true;
  return isInternalHost(u.hostname);
}
