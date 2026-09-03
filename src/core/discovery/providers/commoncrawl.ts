import { tokenize } from '../../text.js';
import { fetchJson, fetchText } from './base.js';
import { makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

interface CcCollection {
  id: string;
  'cdx-api': string;
}

/**
 * The Common Crawl URL index. No key. Best for domain / URL queries — it lists
 * pages Common Crawl has captured for a host, which is a strong signal that real
 * public content exists even when live search returns nothing.
 */
export class CommonCrawlProvider implements SearchProvider {
  readonly name = 'Common Crawl';
  readonly category = 'archives' as const;
  readonly priority = 7;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = ['domain', 'url', 'organization'] as const;
  readonly configured = true;

  private cdxApi: string | null = null;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 9000;
  }

  private async latestCdxApi(signal: AbortSignal): Promise<string> {
    if (this.cdxApi) return this.cdxApi;
    const collections = await fetchJson<CcCollection[]>(
      'https://index.commoncrawl.org/collinfo.json',
      { timeoutMs: this.timeoutMs, signal, fetchImpl: this.opts.fetchImpl },
    );
    const first = collections[0];
    if (!first?.['cdx-api']) throw new Error('no Common Crawl collection available');
    this.cdxApi = first['cdx-api'];
    return this.cdxApi;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    const e = ctx.classification.entities;
    const host =
      e.hostname ??
      e.rootDomain ??
      (ctx.classification.type === 'domain' ? ctx.classification.value : null) ??
      query.trim().match(/([a-z0-9-]+\.)+[a-z]{2,}/i)?.[0];
    if (!host) return [];

    const api = await this.latestCdxApi(ctx.signal);
    const limit = Math.min(Math.max(ctx.limit, 10), 30);
    const url = `${api}?output=json&limit=${limit}&filter=status:200&url=${encodeURIComponent(`${host}/*`)}`;
    const text = await fetchText(url, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
    });
    const seen = new Set<string>();
    const out: UnifiedResult[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let record: { url?: string; timestamp?: string };
      try {
        record = JSON.parse(line) as { url?: string; timestamp?: string };
      } catch {
        continue;
      }
      if (!record.url || seen.has(record.url)) continue;
      seen.add(record.url);
      out.push(
        makeResult({
          title: record.url.replace(/^https?:\/\//, ''),
          url: record.url,
          snippet: `Public page indexed by Common Crawl${
            record.timestamp ? ` (crawl ${record.timestamp.slice(0, 8)})` : ''
          }.`,
          provider: this.name,
          origin: 'archive',
          source: host,
          tags: ['common-crawl'],
          score: 0.3,
          terms,
        }),
      );
    }
    return out;
  }
}
