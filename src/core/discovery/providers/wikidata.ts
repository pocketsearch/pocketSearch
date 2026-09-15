import { tokenize } from '../../text.js';
import { fetchJson } from './base.js';
import { lexicalRelevance, makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

interface WbSearchResponse {
  search?: Array<{
    id: string;
    label?: string;
    description?: string;
    concepturi?: string;
    match?: { text?: string };
  }>;
}

/**
 * Wikidata entity search (`wbsearchentities`). No key. Resolves a term to
 * structured entities with a one-line description — a strong disambiguation and
 * "what is this" signal that complements Wikipedia's prose.
 */
export class WikidataProvider implements SearchProvider {
  readonly name = 'Wikidata';
  readonly category = 'reference' as const;
  readonly priority = 3;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = [];
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 6000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    const url =
      'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*' +
      `&language=en&uselang=en&type=item&limit=${Math.min(Math.max(ctx.limit, 5), 20)}` +
      `&search=${encodeURIComponent(query)}`;
    const body = await fetchJson<WbSearchResponse>(url, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
      headers: { 'user-agent': 'BeaconSearchBot/1.0 (discovery)' },
    });
    return (body.search ?? [])
      .filter((row) => row.label)
      .map((row) => {
        const snippet = row.description ?? row.match?.text ?? '';
        return makeResult({
          title: row.label as string,
          url: row.concepturi ?? `https://www.wikidata.org/wiki/${row.id}`,
          snippet: snippet ? `${snippet} · Wikidata ${row.id}` : `Wikidata entity ${row.id}`,
          provider: this.name,
          origin: 'web',
          source: 'wikidata.org',
          tags: ['wikidata', 'entity'],
          score: 0.35 + 0.4 * lexicalRelevance(`${row.label} ${snippet}`, terms),
          terms,
        });
      });
  }
}
