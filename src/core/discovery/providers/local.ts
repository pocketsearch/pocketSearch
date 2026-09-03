import { tokenize } from '../../text.js';
import type { BeaconDocument, SearchQuery, SearchResponse } from '../../types.js';
import { searchQuerySchema } from '../../types.js';
import { makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

export interface LocalEngineLike {
  search(query: SearchQuery, options?: { combineWith?: 'AND' | 'OR' }): SearchResponse;
  get(id: string): BeaconDocument | undefined;
}

/**
 * The local Abeacon index. Runs an AND pass first (precise), then, if that is
 * thin, an OR pass (recall) — so a multi-word query where no single document
 * contains every term still returns its best partial matches.
 */
export class LocalIndexProvider implements SearchProvider {
  readonly name = 'Local index';
  readonly category = 'local' as const;
  readonly priority = 0;
  readonly timeoutMs = 1000;
  readonly supportedQueryTypes = [];
  readonly configured = true;

  constructor(private readonly engine: LocalEngineLike) {}

  search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    const parsed = searchQuerySchema.parse({
      q: query,
      limit: Math.max(ctx.limit, 20),
      tags: ctx.tags,
    });

    const seen = new Set<string>();
    const out: UnifiedResult[] = [];
    const collect = (res: SearchResponse) => {
      for (const hit of res.hits) {
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        out.push(
          makeResult({
            title: hit.title,
            snippet: hit.snippet,
            url: hit.url,
            provider: this.name,
            origin: 'index',
            kind: 'exact',
            tags: hit.tags,
            source: hit.source,
            score: hit.score,
            terms: hit.terms.length ? hit.terms : terms,
            preHighlighted: true,
          }),
        );
      }
    };

    collect(this.engine.search(parsed, { combineWith: 'AND' }));
    if (out.length < 5 && query.trim().includes(' ')) {
      collect(this.engine.search(parsed, { combineWith: 'OR' }));
    }
    return Promise.resolve(out);
  }
}
