import { isIP } from 'node:net';
import type { ReconTarget } from './types.js';

/**
 * Multi-label public suffixes common enough to be worth special-casing so
 * `example.co.uk` yields `example.co.uk` rather than `co.uk`. This is a
 * pragmatic shortlist, not the full Public Suffix List — recon only uses the
 * registrable domain for display and crt.sh queries, both of which tolerate an
 * occasional near-miss.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'me.uk',
  'net.uk',
  'sch.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'gov.au',
  'com.br',
  'com.cn',
  'com.mx',
  'com.tr',
  'co.nz',
  'co.za',
  'co.jp',
  'co.kr',
  'co.in',
  'com.sg',
  'com.hk',
]);

/** eTLD+1 for a hostname, using {@link MULTI_LABEL_SUFFIXES} as a shortcut. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * Parse a recon target from a bare domain, an IP literal, or a full URL.
 * Throws on anything that is neither — the callers surface that as a 400 / usage
 * error rather than silently guessing.
 */
export function parseReconTarget(input: string): ReconTarget {
  const raw = input.trim();
  if (!raw) throw new Error('recon target is empty');

  let host = raw;
  let kind: ReconTarget['kind'] = 'domain';

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(`"${input}" is not a valid URL`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`unsupported URL scheme "${parsed.protocol}"`);
    }
    host = parsed.hostname.replace(/^\[|\]$/g, '');
    kind = 'url';
  } else {
    // bare host[:port][/path] — but a bracketed or multi-colon value is IPv6
    let bare = raw.split('/')[0]!;
    const bracketed = /^\[(.+)\]$/.exec(bare);
    if (bracketed) {
      host = bracketed[1]!;
    } else if (isIP(bare)) {
      host = bare;
    } else {
      // strip a trailing :port only (single colon, numeric suffix)
      bare = bare.replace(/:\d+$/, '');
      host = bare;
    }
  }

  host = host.toLowerCase().replace(/\.$/, '');

  const ipKind = isIP(host);
  if (ipKind) {
    return { input, kind: 'ip', host, url: `http://${ipKind === 6 ? `[${host}]` : host}/` };
  }

  if (!HOSTNAME_RE.test(host)) {
    throw new Error(`"${input}" is not a domain, IP address, or URL`);
  }

  return {
    input,
    kind: kind === 'url' ? 'url' : 'domain',
    host,
    registrableDomain: registrableDomain(host),
    url: `https://${host}/`,
  };
}

/** Heuristic: does this free-text query look like nothing but a domain / IP? */
export function looksLikeBareTarget(query: string): boolean {
  const t = query.trim();
  if (/\s/.test(t)) return false;
  if (isIP(t)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false; // a URL is a search, not a target
  return HOSTNAME_RE.test(t.replace(/\/.*$/, ''));
}
