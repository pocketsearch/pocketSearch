import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchWithTimeout } from '../http.js';
import type { RegistrationInfo } from './types.js';

const execFileAsync = promisify(execFile);

interface RdapVcardEntity {
  roles?: string[];
  vcardArray?: [string, Array<[string, Record<string, unknown>, string, unknown]>];
  publicIds?: Array<{ type?: string; identifier?: string }>;
  handle?: string;
}

interface RdapResponse {
  handle?: string;
  ldhName?: string;
  status?: string[];
  events?: Array<{ eventAction?: string; eventDate?: string }>;
  nameservers?: Array<{ ldhName?: string }>;
  entities?: RdapVcardEntity[];
  secureDNS?: { delegationSigned?: boolean };
}

function vcardValue(entity: RdapVcardEntity, field: string): string | undefined {
  const items = entity.vcardArray?.[1] ?? [];
  for (const item of items) {
    if (item[0] === field) {
      const value = item[3];
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return value.filter(Boolean).join(', ');
    }
  }
  return undefined;
}

function pickEntity(entities: RdapVcardEntity[] | undefined, role: string): RdapVcardEntity | undefined {
  return entities?.find((e) => e.roles?.includes(role));
}

/** Parse the IANA-standard RDAP JSON into our flat {@link RegistrationInfo}. */
function fromRdap(data: RdapResponse): RegistrationInfo {
  const eventDate = (action: string) =>
    data.events?.find((e) => e.eventAction === action)?.eventDate;

  const registrar = pickEntity(data.entities, 'registrar');
  const registrant = pickEntity(data.entities, 'registrant');
  const ianaId = registrar?.publicIds?.find((p) => /IANA/i.test(p.type ?? ''))?.identifier;

  return {
    available: true,
    source: 'rdap',
    registrar: registrar ? (vcardValue(registrar, 'fn') ?? registrar.handle) : undefined,
    registrarIanaId: ianaId,
    createdAt: eventDate('registration'),
    updatedAt: eventDate('last changed') ?? eventDate('last update of RDAP database'),
    expiresAt: eventDate('expiration'),
    statuses: data.status ?? [],
    nameServers: (data.nameservers ?? [])
      .map((n) => n.ldhName?.toLowerCase())
      .filter((n): n is string => Boolean(n)),
    registrantOrg: registrant ? vcardValue(registrant, 'org') : undefined,
    registrantCountry: registrant
      ? (vcardValue(registrant, 'adr')?.split(',').pop()?.trim() || undefined)
      : undefined,
    dnssec: data.secureDNS?.delegationSigned,
  };
}

const WHOIS_PATTERNS: Array<[keyof RegistrationInfo | 'nameServer' | 'status', RegExp]> = [
  ['registrar', /^\s*Registrar:\s*(.+?)\s*$/im],
  ['registrarIanaId', /^\s*Registrar IANA ID:\s*(.+?)\s*$/im],
  ['createdAt', /^\s*Creation Date:\s*(.+?)\s*$/im],
  ['updatedAt', /^\s*Updated Date:\s*(.+?)\s*$/im],
  ['expiresAt', /^\s*Regist(?:ry|rar) Expiry Date:\s*(.+?)\s*$/im],
  ['registrantOrg', /^\s*Registrant Organization:\s*(.+?)\s*$/im],
  ['registrantCountry', /^\s*Registrant Country:\s*(.+?)\s*$/im],
];

function fromWhois(raw: string): RegistrationInfo {
  const info: RegistrationInfo = {
    available: true,
    source: 'whois',
    statuses: [],
    nameServers: [],
    raw: raw.slice(0, 8000),
  };
  const mut = info as unknown as Record<string, unknown>;
  for (const [key, re] of WHOIS_PATTERNS) {
    const m = re.exec(raw);
    if (m?.[1]) mut[key] = m[1].trim();
  }
  info.statuses = [...raw.matchAll(/^\s*Domain Status:\s*(.+?)\s*$/gim)].map((m) => m[1]!.trim());
  info.nameServers = [
    ...new Set(
      [...raw.matchAll(/^\s*Name Server:\s*(.+?)\s*$/gim)].map((m) => m[1]!.trim().toLowerCase()),
    ),
  ];
  const dnssec = /^\s*DNSSEC:\s*(.+?)\s*$/im.exec(raw)?.[1]?.trim().toLowerCase();
  if (dnssec) info.dnssec = dnssec !== 'unsigned' && dnssec !== 'no';
  return info;
}

export interface RegistrationOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Try the system `whois` binary if RDAP returns nothing. Default true. */
  allowWhoisFallback?: boolean;
}

/**
 * Domain registration data. Prefers RDAP (`https://rdap.org` bootstrap → the
 * registry's RDAP server, structured JSON, no key). Falls back to the system
 * `whois` binary if present and RDAP has nothing.
 */
export async function lookupRegistration(
  domain: string,
  opts: RegistrationOptions,
): Promise<RegistrationInfo> {
  try {
    const res = await fetchWithTimeout(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { accept: 'application/rdap+json, application/json' },
      timeoutMs: opts.timeoutMs,
      fetchImpl: opts.fetchImpl,
      parentSignal: opts.signal,
      redirect: 'follow',
    });
    if (res.ok) {
      const parsed = fromRdap((await res.json()) as RdapResponse);
      if (parsed.registrar || parsed.createdAt || parsed.nameServers.length) return parsed;
    }
  } catch {
    // fall through to whois
  }

  if (opts.allowWhoisFallback !== false) {
    try {
      const { stdout } = await execFileAsync('whois', [domain], {
        timeout: Math.min(opts.timeoutMs + 4000, 20_000),
        maxBuffer: 1024 * 1024,
      });
      if (stdout.trim()) return fromWhois(stdout);
    } catch {
      // whois not installed / timed out / errored
    }
  }

  return { available: false, source: null, statuses: [], nameServers: [] };
}
