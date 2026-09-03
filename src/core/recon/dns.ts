import { fetchWithTimeout } from '../http.js';
import type { DnsRecords } from './types.js';

interface DohAnswer {
  name: string;
  type: number;
  TTL?: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

const TYPE_CODES: Record<keyof Omit<DnsRecords, 'SPF' | 'DMARC' | 'nxdomain'>, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  MX: 15,
  TXT: 16,
  AAAA: 28,
};

const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

export interface DnsLookupOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

function unquoteTxt(data: string): string {
  // DoH returns TXT rdata as one or more `"..."` chunks; concatenate them.
  const chunks = data.match(/"([^"]*)"/g);
  if (!chunks) return data.replace(/^"|"$/g, '');
  return chunks.map((c) => c.slice(1, -1)).join('');
}

async function queryType(name: string, type: number, opts: DnsLookupOptions): Promise<DohResponse> {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetchWithTimeout(url, {
    headers: { accept: 'application/dns-json' },
    timeoutMs: opts.timeoutMs,
    fetchImpl: opts.fetchImpl,
    parentSignal: opts.signal,
  });
  if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
  return (await res.json()) as DohResponse;
}

/**
 * Resolve the common record types for `name` over DNS-over-HTTPS (Cloudflare
 * `1.1.1.1`). No system resolver, no extra dependency, works identically in any
 * container. SPF is filtered out of TXT; DMARC is queried at `_dmarc.<name>`.
 */
export async function lookupDns(name: string, opts: DnsLookupOptions): Promise<DnsRecords> {
  const records: DnsRecords = {
    A: [],
    AAAA: [],
    MX: [],
    NS: [],
    TXT: [],
    CNAME: [],
    SOA: [],
    SPF: [],
    DMARC: [],
    nxdomain: false,
  };

  const entries = Object.entries(TYPE_CODES) as Array<[keyof typeof TYPE_CODES, number]>;
  const responses = await Promise.allSettled(
    entries.map(([, code]) => queryType(name, code, opts)),
  );

  let nxdomainVotes = 0;
  let answered = 0;
  responses.forEach((result, i) => {
    const key = entries[i]![0];
    if (result.status !== 'fulfilled') return;
    answered += 1;
    if (result.value.Status === 3) nxdomainVotes += 1;
    for (const ans of result.value.Answer ?? []) {
      if (ans.type !== TYPE_CODES[key]) continue; // skip CNAME hops in an A answer, etc.
      const value = key === 'TXT' ? unquoteTxt(ans.data) : ans.data.replace(/\.$/, '');
      if (!records[key].includes(value)) records[key].push(value);
    }
  });

  records.nxdomain = answered > 0 && nxdomainVotes === answered && records.A.length === 0;
  records.SPF = records.TXT.filter((t) => /^v=spf1\b/i.test(t.trim()));

  try {
    const dmarc = await queryType(`_dmarc.${name}`, TYPE_CODES.TXT, opts);
    for (const ans of dmarc.Answer ?? []) {
      if (ans.type === TYPE_CODES.TXT) records.DMARC.push(unquoteTxt(ans.data));
    }
  } catch {
    // no DMARC record / lookup failed — leave empty
  }

  return records;
}
