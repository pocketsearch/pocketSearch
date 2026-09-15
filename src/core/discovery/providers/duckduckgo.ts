import { tokenize } from '../../text.js';
import { fetchJson } from './base.js';
import { lexicalRelevance, makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

interface DdgTopic {
  Text?: string;
  FirstURL?: string;
  Icon?: unknown;
  Topics?: DdgTopic[];
}

interface DdgInstantAnswer {
  Heading?: string;
  AbstractText?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  Answer?: string;
  AnswerType?: string;
  Definition?: string;
  DefinitionURL?: string;
  RelatedTopics?: DdgTopic[];
}

function flattenTopics(topics: DdgTopic[] | undefined): DdgTopic[] {
  const out: DdgTopic[] = [];
  for (const t of topics ?? []) {
    if (t.Topics) out.push(...flattenTopics(t.Topics));
    else if (t.Text && t.FirstURL) out.push(t);
  }
  return out;
}

/**
 * DuckDuckGo Instant Answer API. No key. Returns a definition / abstract and a
 * set of disambiguation links for encyclopedic terms — not a full web index, but
 * a fast, authoritative first hit for "what is X" style queries.
 */
export class DuckDuckGoProvider implements SearchProvider {
  readonly name = 'DuckDuckGo';
  readonly category = 'reference' as const;
  readonly priority = 3;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = [];
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    const url =
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
      '&format=json&no_html=1&no_redirect=1&skip_disambig=0&t=beacon-search';
    const body = await fetchJson<DdgInstantAnswer>(url, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
    });

    const results: UnifiedResult[] = [];

    const abstract = body.AbstractText || body.Definition;
    const abstractUrl = body.AbstractURL || body.DefinitionURL;
    if (abstract && abstractUrl) {
      results.push(
        makeResult({
          title: body.Heading || query,
          url: abstractUrl,
          snippet: abstract,
          provider: this.name,
          origin: 'web',
          source: body.AbstractSource || 'duckduckgo.com',
          tags: ['instant-answer'],
          score: 0.55 + 0.35 * lexicalRelevance(`${body.Heading ?? ''} ${abstract}`, terms),
          terms,
        }),
      );
    }

    if (body.Answer && typeof body.Answer === 'string') {
      results.push(
        makeResult({
          title: `${body.AnswerType ? `${body.AnswerType}: ` : ''}${body.Answer}`.slice(0, 200),
          url: abstractUrl,
          snippet: body.Answer,
          provider: this.name,
          origin: 'web',
          source: 'duckduckgo.com',
          tags: ['instant-answer', 'computed'],
          score: 0.6,
          terms,
        }),
      );
    }

    for (const topic of flattenTopics(body.RelatedTopics).slice(0, Math.max(ctx.limit, 6))) {
      results.push(
        makeResult({
          title: topic.Text as string,
          url: topic.FirstURL,
          snippet: topic.Text as string,
          provider: this.name,
          origin: 'web',
          source: 'duckduckgo.com',
          tags: ['related-topic'],
          kind: 'related',
          score: 0.25 + 0.35 * lexicalRelevance(topic.Text as string, terms),
          terms,
        }),
      );
    }

    return results;
  }
}
