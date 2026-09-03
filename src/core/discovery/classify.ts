import { isIP } from 'node:net';
import type { QueryClassification, QueryType } from './types.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOI_RE = /^(doi:)?10\.\d{4,9}\/\S+$/i;
const CVE_RE = /^cve-\d{4}-\d{4,7}$/i;
const HASH_RE = /^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/i;
const FILENAME_RE = /^[\w .\-/]+\.[a-z0-9]{1,8}$/i;
const HANDLE_RE = /^@?[a-z0-9](?:[a-z0-9._-]{1,38})$/i;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function rootDomain(host: string): string {
  const parts = host.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  // Handle the common two-label public suffixes without a full PSL.
  const twoLabel = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);
  const last = parts[parts.length - 1] ?? '';
  const penult = parts[parts.length - 2] ?? '';
  if (last.length === 2 && twoLabel.has(penult)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

function classifyUrl(raw: string): QueryClassification | null {
  let u: URL;
  try {
    u = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname.includes('.')) return null;
  const host = u.hostname.replace(/^www\./, '');
  const pathTerms = u.pathname.split(/[/_-]/).filter((s) => s.length > 1);
  const looksLikeBareDomain = !raw.includes('://') && (u.pathname === '/' || u.pathname === '');
  return {
    type: looksLikeBareDomain ? 'domain' : 'url',
    confidence: looksLikeBareDomain ? 0.97 : 0.95,
    value: looksLikeBareDomain ? host : u.toString(),
    entities: {
      hostname: host,
      rootDomain: rootDomain(host),
      ...(pathTerms.length > 0 ? { pathTerms: pathTerms.join(' ') } : {}),
    },
  };
}

/**
 * Classify a raw query so the orchestrator can route it to the right providers
 * and build sensible entity pivots. Best-effort and deliberately conservative —
 * when nothing matches it falls back to `phrase` / `text`.
 */
export function classifyQuery(raw: string): QueryClassification {
  const q = raw.trim();
  const bare = q.replace(/^["']|["']$/g, '').trim();
  const lower = bare.toLowerCase();

  const plain = (type: QueryType, confidence: number, value = bare): QueryClassification => ({
    type,
    confidence,
    value,
    entities: {},
  });

  if (q.length === 0) return plain('text', 1, '');

  if (EMAIL_RE.test(bare)) {
    const [local, host] = bare.split('@') as [string, string];
    return {
      type: 'email',
      confidence: 0.98,
      value: lower,
      entities: { localPart: local, domain: host.toLowerCase(), rootDomain: rootDomain(host) },
    };
  }

  if (isIP(bare)) return plain('ip', 0.99, bare);
  if (CVE_RE.test(bare)) return plain('cve', 0.99, bare.toUpperCase());
  if (DOI_RE.test(bare)) return plain('doi', 0.98, lower.replace(/^doi:/, ''));
  if (HASH_RE.test(bare)) return plain('hash', 0.9, lower);

  if (/^https?:\/\//i.test(bare) || DOMAIN_RE.test(bare)) {
    const asUrl = classifyUrl(bare);
    if (asUrl) return asUrl;
  }

  if (!bare.includes(' ')) {
    if (REPO_RE.test(bare) && !bare.includes('.')) {
      const [owner, repo] = bare.split('/') as [string, string];
      return { type: 'repository', confidence: 0.8, value: bare, entities: { owner, repo } };
    }
    if (FILENAME_RE.test(bare) && /\.[a-z0-9]{1,8}$/i.test(bare)) {
      return plain('filename', 0.75, bare);
    }
    if (bare.startsWith('@') && HANDLE_RE.test(bare)) {
      return plain('username', 0.9, bare.replace(/^@/, ''));
    }
    if (HANDLE_RE.test(bare) && /[._-]/.test(bare)) {
      return plain('username', 0.6, bare);
    }
  }

  // Quoted → phrase. A short run of Capitalised Words → likely a person/org name.
  if (/^".+"$/.test(q) || /^'.+'$/.test(q)) return plain('phrase', 0.85);

  const words = bare.split(/\s+/);
  const capitalised = words.filter((w) => /^[A-Z][a-z’'-]+$/.test(w));
  if (words.length >= 2 && words.length <= 4 && capitalised.length === words.length) {
    return plain('person', 0.5);
  }
  // A long, mostly non-question span with several capitalised words reads like a
  // paper / document title; a plain long question does not.
  const QUESTION_START = /^(who|what|when|where|why|how|is|are|can|does|do|did|should|which)\b/i;
  if (words.length >= 8 && !QUESTION_START.test(bare) && capitalised.length >= 2) {
    return plain('academic_title', 0.35);
  }

  return plain('text', 0.5);
}
