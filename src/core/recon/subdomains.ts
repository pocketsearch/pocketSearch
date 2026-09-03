import { fetchWithTimeout } from '../http.js';
import type { SubdomainInfo } from './types.js';

interface CrtShEntry {
  name_value?: string;
  common_name?: string;
}

export interface SubdomainOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  limit?: number;
}

/**
 * Enumerate hostnames seen in certificate-transparency logs for a domain via
 * crt.sh. Public log data — the same source the discovery cascade's
 * Certificate Transparency provider uses, here rendered as a flat subdomain list.
 */
export async function enumerateSubdomains(
  domain: string,
  opts: SubdomainOptions,
): Promise<SubdomainInfo> {
  const limit = opts.limit ?? 200;
  try {
    const res = await fetchWithTimeout(
      `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`,
      {
        headers: { accept: 'application/json' },
        timeoutMs: opts.timeoutMs,
        fetchImpl: opts.fetchImpl,
        parentSignal: opts.signal,
      },
    );
    if (!res.ok) throw new Error(`crt.sh HTTP ${res.status}`);
    const entries = (await res.json()) as CrtShEntry[];

    const found = new Set<string>();
    for (const entry of entries) {
      const names = `${entry.name_value ?? ''}\n${entry.common_name ?? ''}`.split(/\n+/);
      for (const name of names) {
        const host = name.trim().toLowerCase().replace(/^\*\./, '');
        if (host && host !== domain && host.endsWith(`.${domain}`)) found.add(host);
      }
    }

    return {
      available: true,
      source: 'crt.sh',
      subdomains: [...found].sort().slice(0, limit),
      totalFound: found.size,
    };
  } catch {
    return { available: false, source: 'crt.sh', subdomains: [], totalFound: 0 };
  }
}
