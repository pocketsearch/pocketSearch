import { tokenize } from '../../text.js';
import { fetchJson } from './base.js';
import { lexicalRelevance, makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

interface HnResponse {
  hits?: Array<{
    objectID: string;
    title?: string;
    story_title?: string;
    url?: string;
    story_url?: string;
    author?: string;
    points?: number;
    num_comments?: number;
    created_at?: string;
    _highlightResult?: unknown;
  }>;
}

/** Hacker News via the Algolia HN Search API. No key. Good for software, people,
 *  usernames, companies and current-events discussion. */
export class HackerNewsProvider implements SearchProvider {
  readonly name = 'Hacker News';
  readonly category = 'code' as const;
  readonly priority = 4;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = [];
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 6000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    const isUser = ctx.classification.type === 'username';
    const q = isUser ? ctx.classification.value : query;
    const url =
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}` +
      `&tags=(story,comment)&hitsPerPage=${Math.min(Math.max(ctx.limit, 5), 20)}`;
    const body = await fetchJson<HnResponse>(url, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
    });
    const hits = body.hits ?? [];
    return hits
      .map((hit): UnifiedResult | null => {
        const title = hit.title || hit.story_title;
        const link = hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
        if (!title) return null;
        const meta = [
          hit.author ? `by ${hit.author}` : null,
          typeof hit.points === 'number' ? `${hit.points} points` : null,
          typeof hit.num_comments === 'number' ? `${hit.num_comments} comments` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return makeResult({
          title,
          url: link,
          snippet: meta,
          provider: this.name,
          origin: 'code',
          source: 'news.ycombinator.com',
          tags: ['hacker-news'],
          score:
            0.3 +
            0.4 * lexicalRelevance(title, terms) +
            Math.min(0.2, (hit.points ?? 0) / 2000),
          archivedDate: hit.created_at,
          terms,
        });
      })
      .filter((r): r is UnifiedResult => r !== null);
  }
}
