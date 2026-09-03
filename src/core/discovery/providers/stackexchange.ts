import { tokenize } from '../../text.js';
import { fetchJson } from './base.js';
import { lexicalRelevance, makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

interface SeResponse {
  items?: Array<{
    title: string;
    link: string;
    score?: number;
    answer_count?: number;
    is_answered?: boolean;
    creation_date?: number;
    tags?: string[];
  }>;
}

/**
 * Stack Exchange search (Stack Overflow by default) via the public API. No key
 * (anonymous quota is small — the circuit breaker backs off on 429). Strong for
 * programming errors, API usage and "how do I" technical questions.
 */
export class StackExchangeProvider implements SearchProvider {
  readonly name = 'Stack Overflow';
  readonly category = 'code' as const;
  readonly priority = 4;
  readonly timeoutMs: number;

  readonly supportedQueryTypes = [];
  readonly configured = true;

  constructor(
    private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch; site?: string } = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 6000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    const site = this.opts.site ?? 'stackoverflow';
    const url =
      'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance' +
      `&pagesize=${Math.min(Math.max(ctx.limit, 5), 20)}&site=${site}` +
      `&q=${encodeURIComponent(query)}`;
    const body = await fetchJson<SeResponse>(url, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
    });
    return (body.items ?? []).map((item) => {
      const meta = [
        typeof item.score === 'number' ? `${item.score} votes` : null,
        typeof item.answer_count === 'number' ? `${item.answer_count} answers` : null,
        item.is_answered ? 'accepted' : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return makeResult({
        title: decodeEntities(item.title),
        url: item.link,
        snippet: meta,
        provider: this.name,
        origin: 'code',
        source: `${site === 'stackoverflow' ? 'stackoverflow.com' : `${site}.stackexchange.com`}`,
        tags: ['stack-exchange', ...(item.tags ?? []).slice(0, 5)],
        score:
          0.3 +
          0.4 * lexicalRelevance(decodeEntities(item.title), terms) +
          Math.min(0.2, (item.score ?? 0) / 100) +
          (item.is_answered ? 0.1 : 0),
        archivedDate: item.creation_date
          ? new Date(item.creation_date * 1000).toISOString()
          : undefined,
        terms,
      });
    });
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}
