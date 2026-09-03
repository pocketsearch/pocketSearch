import { tokenize } from '../../text.js';
import { fetchJson } from './base.js';
import { lexicalRelevance, makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

interface WikiSearchResponse {
  query?: {
    search?: Array<{ title: string; snippet: string; timestamp?: string }>;
  };
}

/**
 * English Wikipedia via the MediaWiki API (`list=search`). No key, generous
 * limits, and — being an encyclopedia — it returns *something* useful for almost
 * any real-world term, which makes it a strong general fallback.
 */
export class WikipediaProvider implements SearchProvider {
  readonly name = 'Wikipedia';
  readonly category = 'reference' as const;
  readonly priority = 2;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = [];
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 6000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    const url =
      'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*' +
      `&srlimit=${Math.min(Math.max(ctx.limit, 5), 20)}&srsearch=${encodeURIComponent(query)}`;
    const body = await fetchJson<WikiSearchResponse>(url, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
      headers: { 'user-agent': 'BeaconSearchBot/1.0 (discovery)' },
    });
    const rows = body.query?.search ?? [];
    return rows.map((row) => {
      const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(row.title.replace(/ /g, '_'))}`;
      const snippet = row.snippet.replace(/<[^>]+>/g, '');
      return makeResult({
        title: row.title,
        url: pageUrl,
        snippet,
        provider: this.name,
        origin: 'web',
        source: 'en.wikipedia.org',
        tags: ['wikipedia'],
        score: 0.4 + 0.4 * lexicalRelevance(`${row.title} ${snippet}`, terms),
        archivedDate: row.timestamp,
        terms,
      });
    });
  }
}
