import { tokenize } from '../../text.js';
import { fetchJson } from './base.js';
import { makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

interface CrtEntry {
  name_value: string;
  common_name?: string;
  issuer_name?: string;
  not_before?: string;
}

/**
 * crt.sh certificate transparency logs. No key. For a domain/organization query
 * it surfaces subdomains and related hostnames from issued TLS certificates — a
 * classic way to discover material that isn't otherwise indexed.
 */
export class CrtShProvider implements SearchProvider {
  readonly name = 'Certificate Transparency';
  readonly category = 'infrastructure' as const;
  readonly priority = 8;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = ['domain', 'url', 'organization', 'email'] as const;
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 9000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    const e = ctx.classification.entities;
    const domain =
      e.rootDomain ??
      e.domain ??
      (ctx.classification.type === 'domain' ? ctx.classification.value : null) ??
      query.trim().match(/([a-z0-9-]+\.)+[a-z]{2,}/i)?.[0];
    if (!domain) return [];

    const url = `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`;
    const rows = await fetchJson<CrtEntry[]>(url, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
    });
    const hosts = new Map<string, string | undefined>();
    for (const row of rows) {
      for (const name of (row.name_value ?? '').split(/\n+/)) {
        const host = name.trim().toLowerCase().replace(/^\*\./, '');
        if (host && host.endsWith(domain) && !hosts.has(host)) hosts.set(host, row.not_before);
      }
    }
    return [...hosts.entries()].slice(0, Math.max(ctx.limit, 15)).map(([host, since]) =>
      makeResult({
        title: host,
        url: `https://${host}/`,
        snippet: `Hostname observed in certificate transparency logs for ${domain}${
          since ? `, first seen ${since.slice(0, 10)}` : ''
        }.`,
        provider: this.name,
        origin: 'web',
        source: 'crt.sh',
        tags: ['subdomain', 'certificate-transparency'],
        score: 0.3,
        terms,
      }),
    );
  }
}
