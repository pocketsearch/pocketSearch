import type { AnswerConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { normalizeWhitespace, tokenize } from '../text.js';
import { analyzeSources } from './analysis.js';
import { formatCalculation, tryCalculate } from './calculator.js';
import {
  selectGroundedClaims,
  splitSentences,
  STOPWORDS,
  weaveExtractive,
  type GroundedClaim,
} from './extract.js';
import {
  createLlmSynthesizers,
  type LlmSynthesizer,
  type SynthesisExtract,
} from './providers/llm.js';
import { createWebSearchProvider, type WebSearchProvider } from './providers/web-search.js';
import { gatherSources, type EngineLike, type RetrievedSource } from './retrieval.js';
import type {
  AnswerClaim,
  AnswerConfidence,
  AnswerResponse,
  AnswerSource,
  Synthesizer,
} from './types.js';

export { type EngineLike } from './retrieval.js';

/** Thrown when too many answer requests are already in flight. */
export class AnswerBusyError extends Error {
  constructor() {
    super('the answer service is busy; try again shortly');
    this.name = 'AnswerBusyError';
  }
}

export interface AnswerServiceDeps {
  engine: EngineLike;
  config: AnswerConfig;
  userAgent: string;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  /** Overrides for tests. */
  webSearch?: WebSearchProvider | null;
  synthesizers?: LlmSynthesizer[];
  now?: () => Date;
}

export interface AnswerOptions {
  fresh?: boolean;
  signal?: AbortSignal;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 100;
const MAX_CONCURRENT = 4;
const LLM_SENTINEL = 'the available sources do not answer this question';

function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

interface CacheEntry {
  value: AnswerResponse;
  expires: number;
}

export class AnswerService {
  private readonly deps: AnswerServiceDeps;
  private readonly cache = new Map<string, CacheEntry>();
  private inFlight = 0;

  constructor(deps: AnswerServiceDeps) {
    this.deps = deps;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Public capability summary for `/health` (no secrets). */
  get capabilities(): { enabled: true; webSearch: string | null; llm: string[] } {
    const webSearch = this.resolveWebSearch();
    return {
      enabled: true,
      webSearch: webSearch?.name ?? null,
      llm: this.resolveSynthesizers().map((s) => s.name),
    };
  }

  private resolveWebSearch(): WebSearchProvider | null {
    if (this.deps.webSearch !== undefined) return this.deps.webSearch;
    return createWebSearchProvider(this.deps.config, this.deps.fetchImpl);
  }

  private resolveSynthesizers(): LlmSynthesizer[] {
    return this.deps.synthesizers ?? createLlmSynthesizers(this.deps.config, this.deps.fetchImpl);
  }

  async answer(query: string, options: AnswerOptions = {}): Promise<AnswerResponse> {
    const normalized = normalizeWhitespace(query);
    const key = normalized.toLowerCase();

    if (!options.fresh) {
      const hit = this.cache.get(key);
      if (hit && hit.expires > Date.now()) return { ...hit.value, cached: true };
    }

    if (this.inFlight >= MAX_CONCURRENT) throw new AnswerBusyError();
    this.inFlight += 1;
    const startedAt = performance.now();
    try {
      const response = await this.build(normalized, options, startedAt);
      this.store(key, response);
      return response;
    } finally {
      this.inFlight -= 1;
    }
  }

  private store(key: string, value: AnswerResponse): void {
    this.cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    while (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private async build(
    query: string,
    options: AnswerOptions,
    startedAt: number,
  ): Promise<AnswerResponse> {
    const warnings: string[] = [];

    // Inline calculator — a self-contained sum / percentage / unit conversion is
    // answered deterministically, before any retrieval.
    const calculation = tryCalculate(query);
    if (calculation) {
      return {
        query,
        answer: formatCalculation(calculation),
        claims: [
          { text: formatCalculation(calculation), sourceIds: [], supported: true },
        ],
        sources: [],
        confidence: 'high',
        confidenceReason: 'computed directly from the query',
        synthesizer: 'calculator',
        warnings,
        generatedAt: this.now().toISOString(),
        tookMs: Number((performance.now() - startedAt).toFixed(1)),
        cached: false,
        calculation,
      };
    }

    const { sources: gathered, warnings: gatherWarnings } = await gatherSources(query, {
      engine: this.deps.engine,
      webSearch: this.resolveWebSearch(),
      config: this.deps.config,
      userAgent: this.deps.userAgent,
      fetchImpl: this.deps.fetchImpl,
      logger: this.deps.logger,
      signal: options.signal,
    });
    warnings.push(...gatherWarnings);

    // Drop index sources that contributed no query-relevant sentence, then
    // renumber so the `[n]` markers stay contiguous.
    let grounded = selectGroundedClaims(query, gathered);
    const groundedIds = new Set(grounded.map((g) => g.sourceId));
    const kept = gathered.filter((s) => s.origin === 'web' || groundedIds.has(s.id));
    const idMap = new Map(kept.map((s, i) => [s.id, i + 1]));
    const retrieved: RetrievedSource[] = kept.map((s, i) => ({ ...s, id: i + 1 }));
    grounded = grounded
      .map((g) => ({ ...g, sourceId: idMap.get(g.sourceId) ?? 0 }))
      .filter((g) => g.sourceId > 0);
    const finish = (
      partial: Pick<
        AnswerResponse,
        'answer' | 'claims' | 'confidence' | 'confidenceReason' | 'synthesizer' | 'disclaimer'
      >,
    ): AnswerResponse => {
      const publicSources = retrieved.map((s) => this.toPublicSource(s, grounded));
      return {
        query,
        sources: publicSources,
        warnings,
        generatedAt: this.now().toISOString(),
        tookMs: Number((performance.now() - startedAt).toFixed(1)),
        cached: false,
        analysis: analyzeSources(publicSources) ?? undefined,
        ...partial,
      };
    };

    if (retrieved.length === 0) {
      return finish({
        answer:
          'No reliable source was found for this query. Try rephrasing it, or add material through the Crawl or Add tabs so Beacon has something to answer from.',
        claims: [],
        confidence: 'none',
        confidenceReason: 'no sources could be retrieved from the index or the web',
        synthesizer: 'extractive',
        disclaimer: 'This response is not backed by any source.',
      });
    }

    // --- Weave -------------------------------------------------------------
    const extracts = this.buildExtracts(retrieved, grounded);
    let prose = weaveExtractive(grounded);
    let synthesizer: Synthesizer = 'extractive';

    for (const llm of this.resolveSynthesizers()) {
      try {
        const woven = await llm.weave({ query, extracts }, options.signal);
        prose = woven;
        synthesizer = llm.kind;
        break;
      } catch (error) {
        warnings.push(
          `${llm.name} synthesis failed (${error instanceof Error ? error.message : String(error)}); used the extractive fallback`,
        );
      }
    }

    const sentinelHit =
      synthesizer !== 'extractive' && prose.toLowerCase().replace(/[.\s]+$/, '') === LLM_SENTINEL;

    // --- Verify citations ------------------------------------------------
    const claims = sentinelHit ? [] : this.verify(prose, retrieved);
    const supported = claims.filter((c) => c.supported);
    const cleanAnswer = claims.map((c) => c.text).join(' ');

    // --- Confidence ----------------------------------------------------
    const hasTrusted = retrieved.some((s) => s.trust === 'official' || s.trust === 'established');
    const hasLive = retrieved.some((s) => s.live);
    const unsupportedRatio = claims.length === 0 ? 1 : 1 - supported.length / claims.length;

    let confidence: AnswerConfidence;
    let confidenceReason: string;
    if (sentinelHit || supported.length === 0) {
      confidence = 'none';
      confidenceReason = 'no statement in the answer could be tied to a retrieved source';
    } else if (retrieved.length >= 2 && hasTrusted && hasLive && unsupportedRatio === 0) {
      confidence = 'high';
      confidenceReason = `every statement is backed by one of ${retrieved.length} sources, including a high-trust source`;
    } else if (hasTrusted && unsupportedRatio <= 0.5) {
      confidence = 'medium';
      confidenceReason = `most statements are backed by sources, at least one of them high-trust`;
    } else {
      confidence = 'low';
      confidenceReason = hasTrusted
        ? `${Math.round(unsupportedRatio * 100)}% of statements could not be tied to a source`
        : 'no high-trust source was available; sources are of unverified reliability';
    }

    if (confidence === 'none') {
      return this.noneResponse(query, retrieved, grounded, warnings, synthesizer, prose, startedAt);
    }

    const disclaimer =
      confidence === 'high'
        ? undefined
        : this.disclaimerFor(retrieved, claims.length - supported.length);

    return finish({
      answer: cleanAnswer,
      claims,
      confidence,
      confidenceReason,
      synthesizer,
      disclaimer,
    });
  }

  private noneResponse(
    query: string,
    retrieved: RetrievedSource[],
    grounded: GroundedClaim[],
    warnings: string[],
    synthesizer: Synthesizer,
    prose: string,
    startedAt: number,
  ): AnswerResponse {
    const base = {
      query,
      sources: retrieved.map((s) => this.toPublicSource(s, grounded)),
      warnings,
      generatedAt: this.now().toISOString(),
      tookMs: Number((performance.now() - startedAt).toFixed(1)),
      cached: false,
      confidence: 'none' as const,
      confidenceReason: 'the retrieved sources do not answer this question',
      claims: [] as AnswerClaim[],
      disclaimer:
        'None of the retrieved sources answer this question. Anything below is unverified.',
    };

    if (synthesizer !== 'extractive') {
      const stripped = prose.replace(/\s*\[\d+\]/g, '').trim();
      if (stripped && stripped.toLowerCase().replace(/[.\s]+$/, '') !== LLM_SENTINEL) {
        return {
          ...base,
          synthesizer,
          answer: `Unverified — general knowledge, not backed by a retrieved source:\n\n${stripped}`,
        };
      }
    }
    return {
      ...base,
      synthesizer: 'extractive',
      answer:
        'The retrieved sources do not answer this question, and no verified answer is available.',
    };
  }

  private buildExtracts(sources: RetrievedSource[], grounded: GroundedClaim[]): SynthesisExtract[] {
    return sources.map((s) => {
      const own = grounded.filter((g) => g.sourceId === s.id).map((g) => g.text);
      const text = own.length > 0 ? own.join(' ') : s.text.slice(0, 500);
      return { id: s.id, source: `${s.trust} · ${s.domain ?? s.origin}`, text };
    });
  }

  private verify(prose: string, sources: RetrievedSource[]): AnswerClaim[] {
    const byId = new Map(sources.map((s) => [s.id, s]));
    return splitSentences(prose).map((raw) => {
      const ids = [...raw.matchAll(/\[(\d+)\]/g)]
        .map((m) => Number(m[1]))
        .filter((n) => byId.has(n));
      const uniqueIds = [...new Set(ids)];
      const text = normalizeWhitespace(raw.replace(/\s*\[\d+\]/g, '')).trim();

      let supported = false;
      if (uniqueIds.length > 0) {
        const citedTokens = new Set(
          uniqueIds.flatMap((id) => contentTokens(byId.get(id)?.text ?? '')),
        );
        const sentenceTokens = contentTokens(text);
        const shared = sentenceTokens.filter((t) => citedTokens.has(t)).length;
        supported =
          sentenceTokens.length === 0
            ? false
            : shared >= 4 || shared / sentenceTokens.length >= 0.4;
      }

      const cited = uniqueIds.map((id) => `[${id}]`).join('');
      return {
        text: cited ? `${text} ${cited}` : text,
        sourceIds: uniqueIds,
        supported,
      };
    });
  }

  private disclaimerFor(sources: RetrievedSource[], unsupported: number): string {
    const tiers = new Map<string, number>();
    for (const s of sources) tiers.set(s.trust, (tiers.get(s.trust) ?? 0) + 1);
    const mix = [...tiers.entries()].map(([tier, n]) => `${n} ${tier}`).join(', ');
    const tail =
      unsupported > 0
        ? ` ${unsupported} statement${unsupported === 1 ? '' : 's'} could not be tied to a source and ${unsupported === 1 ? 'is' : 'are'} marked unverified.`
        : '';
    return `Based on ${sources.length} source${sources.length === 1 ? '' : 's'} (${mix}).${tail} Check the cited sources before relying on this.`;
  }

  private toPublicSource(source: RetrievedSource, grounded: GroundedClaim[]): AnswerSource {
    const own = grounded.filter((g) => g.sourceId === source.id).map((g) => g.text);
    const quote = own[0] ?? source.text.slice(0, 240).trim();
    return {
      id: source.id,
      title: source.title,
      url: source.url,
      origin: source.origin,
      domain: source.domain,
      trust: source.trust,
      trustReason: source.trustReason,
      retrievedAt: source.retrievedAt,
      live: source.live,
      quote,
    };
  }
}
