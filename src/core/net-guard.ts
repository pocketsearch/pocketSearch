import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function ipv6IsPrivate(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped?.[1]) return ipv4IsPrivate(mapped[1]);
  return false;
}

export function addressIsPrivate(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4IsPrivate(ip);
  if (kind === 6) return ipv6IsPrivate(ip);
  return true;
}

/**
 * Resolve `hostname` and report whether it (or any address it resolves to) is a
 * loopback / private / link-local address. Used to block SSRF via the crawler.
 */
export async function hostIsPrivate(hostname: string): Promise<boolean> {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return addressIsPrivate(bare);
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  try {
    const records = await lookup(bare, { all: true });
    return records.length === 0 || records.some((r) => addressIsPrivate(r.address));
  } catch {
    return true; // fail closed
  }
}
