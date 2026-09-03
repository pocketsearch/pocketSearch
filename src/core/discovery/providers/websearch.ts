import { tokenize } from '../../text.js';
import type { WebSearchProvider } from '../../answer/providers/web-search.js';
import { lexicalRelevance, makeResult } from '../result.js';
import type { ProviderCategory, ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

/**
 * Adapts the answer layer's `WebSearchProvider` (Brave / Tavily / SearXNG) into a
 * discovery `SearchProvider`, so a configured general-web search backs the
 * cascade with real live results. Unconfigured → `configured=false`, skipped.
 */
export class WebSearchAdapter implements SearchProvider {
  readonly name: string;
  readonly category: ProviderCategory = 'general_web';
  readonly priority = 1;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = [];

  constructor(
    private readonly inner: WebSearchProvider | null,
    opts: { timeoutMs?: number } = {},
  ) {
    this.name = inner ? inner.name : 'Web search';
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  get configured(): boolean {
    return Boolean(this.inner?.configured);
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    if (!this.inner) return [];
    const terms = tokenize(query);
    const results = await this.inner.search(query, Math.max(ctx.limit, 10), ctx.signal);
    return results
      .filter((r) => r.url)
      .map((r) =>
        makeResult({
          title: r.title || r.url,
          url: r.url,
          snippet: r.snippet ?? '',
          provider: this.name,
          origin: 'web',
          score: 0.5 + 0.4 * lexicalRelevance(`${r.title} ${r.snippet ?? ''}`, terms),
          terms,
        }),
      );
  }
}
