import { randomUUID } from 'node:crypto';
import type { Logger } from '../logger.js';
import { hostIsPrivate } from '../net-guard.js';
import { extractReadable, fetchHtml } from '../readable.js';
import { fetchRobots } from '../robots.js';
import { normalizeWhitespace, tokenize } from '../text.js';
import type { DocumentInput } from '../types.js';
import { classifyQuery } from './classify.js';
import { expandQuery } from './expand.js';
import { type CircuitBreaker, runProvider } from './providers/base.js';
import type { LocalEngineLike } from './providers/local.js';
import { dedupe, insufficient, rank } from './rank.js';
import { canonicalUrl, lexicalRelevance } from './result.js';
import { buildSuggestions } from './suggestions.js';
import type {
  OrchestratedResponse,
  ProviderContext,
  ProviderRunReport,
  QueryClassification,
  SearchProvider,
  UnifiedResult,
} from './types.js';
import { TtlCache } from './cache.js';

export interface OrchestratorEngine extends LocalEngineLike {
  upsert?(input: DocumentInput): unknown;
  list?(): Array<{ url?: string }>;
}

export interface OrchestratorDeps {
  engine: OrchestratorEngine;
  providers: SearchProvider[];
  logger?: Logger;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  /** Fetch + index the top few newly-discovered public pages (default true). */
  crawlAndIndex?: boolean;
  /** After a thin normal search, pre-compute the deep search in the background
   *  so a follow-up poll is instant (default true). */
  backgroundDeepen?: boolean;
  /** Allow indexing pages on private hosts (SSRF guard; default false). */
  allowPrivateHosts?: boolean;
  /** Overall deadlines. */
  normalBudgetMs?: number;
  deepBudgetMs?: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  deep?: boolean;
  tags?: string[];
  /** Internal: this call is the background deep pass for another request. */
  background?: boolean;
}

const MAX_FULL_RESULTS = 150;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const STAGE_NUMBER: Record<string, number> = {
  exact: 1,
  expansion: 2,
  discovery: 3,
  pivot: 4,
  persist: 5,
  related: 6,
};

interface CascadeOutcome {
  results: UnifiedResult[];
  stagesRun: string[];
  fallbackStage: number;
  reports: ProviderRunReport[];
}

export class Orchestrator {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly cache = new TtlCache<OrchestratedResponse>(5 * 60_000, 24 * 60 * 60_000);
  private readonly pendingDeep = new Set<string>();

  constructor(private readonly deps: OrchestratorDeps) {}

  /** Provider health snapshot for diagnostics / `/api/health`. */
  get providerHealth(): Array<{ name: string; category: string; status: string; error?: string }> {
    return this.deps.providers.map((p) => {
      const breaker = this.breakers.get(p.name);
      return {
        name: p.name,
        category: p.category,
        status: !p.configured ? 'misconfigured' : (breaker?.status ?? 'healthy'),
        error: breaker?.error,
      };
    });
  }

  private cacheKey(normalized: string, deep: boolean, tags: string[]): string {
    return `${normalized}|${deep ? 'd' : 'n'}|${[...tags].sort().join(',')}`;
  }

  async search(rawQuery: string, options: SearchOptions = {}): Promise<OrchestratedResponse> {
    const queryId = randomUUID().slice(0, 8);
    const started = now();
    const query = rawQuery.trim();
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const offset = Math.max(options.offset ?? 0, 0);
    const deep = Boolean(options.deep);
    const tags = (options.tags ?? []).filter(Boolean);
    const classification = classifyQuery(query);
    const normalized = normalizeWhitespace(query).toLowerCase();

    // Empty query is the one legitimate dead end — it is not a search.
    if (query.length === 0) {
      return this.emptyResponse(query, classification, limit, offset, deep, started);
    }

    const key = this.cacheKey(normalized, deep, tags);
    const cached = this.cache.get(key);
    if (cached && !options.background) {
      return this.paginate(cached.value, offset, limit, {
        cached: true,
        cachedAt: new Date(cached.storedAt).toISOString(),
        searching: this.pendingDeep.has(this.cacheKey(normalized, true, tags)) && !deep,
      });
    }

    const deadline = new AbortController();
    const budget = deep
      ? (this.deps.deepBudgetMs ?? 15_000)
      : (this.deps.normalBudgetMs ?? 5_000);
    const timer = setTimeout(() => deadline.abort(), budget);

    let outcome: CascadeOutcome;
    try {
      outcome = await this.runCascade(
        query,
        classification,
        {
          limit: Math.max(limit + offset, 20),
          deep,
          tags,
          signal: deadline.signal,
          classification,
        },
        queryId,
      );
    } catch (error) {
      this.deps.logger?.error(
        { queryId, err: error instanceof Error ? error.message : String(error) },
        'discovery: cascade crashed — falling back',
      );
      outcome = { results: [], stagesRun: ['error'], fallbackStage: 0, reports: [] };
    } finally {
      clearTimeout(timer);
    }

    const { merged, removed } = dedupe(outcome.results);

    // Stage 6 — demote weak exacts to "related", then guarantee a floor.
    const terms = tokenize(query);
    for (const r of merged) {
      if (r.kind !== 'exact') continue;
      const rel = lexicalRelevance(`${r.title} ${r.snippet}`, terms);
      const floor = r.origin === 'index' ? 0.2 : 0.34;
      if (terms.length > 0 && rel < floor) r.kind = 'related';
    }
    const hasStrongExact = merged.some((r) => r.kind === 'exact');
    let stagesRun = outcome.stagesRun;
    let fallbackStage = outcome.fallbackStage;

    let ranked = rank(merged, { query, classification });

    // If we truly have nothing renderable, try a stale cache entry first.
    if (ranked.length === 0) {
      const stale = this.cache.getStale(key) ?? this.cache.getStale(this.cacheKey(normalized, !deep, tags));
      if (stale) {
        this.deps.logger?.warn({ queryId }, 'discovery: serving stale cache (no live results)');
        return this.paginate(stale.value, offset, limit, {
          cached: true,
          cachedAt: new Date(stale.storedAt).toISOString(),
          searching: false,
        });
      }
    }

    // The guaranteed floor — real, query-derived search shortcuts.
    const suggestions = buildSuggestions(query, classification);
    if (!hasStrongExact || ranked.filter((r) => r.kind !== 'suggestion').length < 3) {
      if (!stagesRun.includes('related')) stagesRun = [...stagesRun, 'related'];
      fallbackStage = Math.max(fallbackStage, 6);
    }
    ranked = [...ranked.filter((r) => r.kind !== 'suggestion'), ...suggestions].slice(
      0,
      MAX_FULL_RESULTS,
    );

    const exactCount = ranked.filter((r) => r.kind === 'exact').length;
    const relatedCount = ranked.filter((r) => r.kind === 'related').length;
    const suggestionCount = ranked.filter((r) => r.kind === 'suggestion').length;

    const facets = { tags: {} as Record<string, number>, sources: {} as Record<string, number> };
    for (const r of ranked) {
      if (r.kind === 'suggestion') continue;
      for (const tag of r.tags) facets.tags[tag] = (facets.tags[tag] ?? 0) + 1;
      if (r.source) facets.sources[r.source] = (facets.sources[r.source] ?? 0) + 1;
    }

    const reports = outcome.reports;
    const full: OrchestratedResponse = {
      query,
      normalizedQuery: normalized,
      queryType: classification.type,
      hits: ranked,
      total: ranked.length,
      limit,
      offset: 0,
      tookMs: Number((now() - started).toFixed(1)),
      facets,
      exactCount,
      relatedCount,
      suggestionCount,
      fallbackStage,
      stagesRun,
      sources: reports,
      sourcesCompleted: reports.filter((r) => r.status === 'healthy').length,
      sourcesPending: 0,
      sourcesFailed: reports.filter(
        (r) => r.status !== 'healthy' && r.status !== 'misconfigured',
      ).length,
      searching: false,
      cached: false,
      cachedAt: null,
      deep,
    };

    this.cache.set(key, full);

    this.deps.logger?.info(
      {
        queryId,
        query,
        classification: classification.type,
        deep,
        stagesRun,
        fallbackStage,
        providers: reports.map((r) => ({ name: r.name, status: r.status, ms: r.ms, n: r.count })),
        rawResults: outcome.results.length,
        duplicatesRemoved: removed,
        exactCount,
        relatedCount,
        finalResults: ranked.length,
        totalDurationMs: Math.round(now() - started),
      },
      'discovery search',
    );

    // Background widening: if a shallow search was thin, pre-compute the deep one.
    let searching = false;
    if (this.deps.backgroundDeepen !== false && !deep && !options.background && fallbackStage >= 2) {
      const deepKey = this.cacheKey(normalized, true, tags);
      if (!this.cache.has(deepKey) && !this.pendingDeep.has(deepKey)) {
        this.pendingDeep.add(deepKey);
        searching = true;
        void this.search(rawQuery, { ...options, deep: true, offset: 0, background: true })
          .catch((error) => {
            this.deps.logger?.debug(
              { queryId, err: error instanceof Error ? error.message : String(error) },
              'discovery: background deep pass failed',
            );
          })
          .finally(() => this.pendingDeep.delete(deepKey));
      }
    }

    // Fire-and-forget: pull a few newly discovered public pages into the index.
    if (this.deps.crawlAndIndex !== false && this.deps.engine.upsert) {
      void this.indexDiscoveries(ranked, queryId).catch(() => undefined);
    }

    return this.paginate(full, offset, limit, { searching });
  }

  private paginate(
    full: OrchestratedResponse,
    offset: number,
    limit: number,
    over: Partial<Pick<OrchestratedResponse, 'cached' | 'cachedAt' | 'searching'>>,
  ): OrchestratedResponse {
    return {
      ...full,
      ...over,
      offset,
      limit,
      hits: full.hits.slice(offset, offset + limit),
    };
  }

  private emptyResponse(
    query: string,
    classification: QueryClassification,
    limit: number,
    offset: number,
    deep: boolean,
    started: number,
  ): OrchestratedResponse {
    return {
      query,
      normalizedQuery: '',
      queryType: classification.type,
      hits: [],
      total: 0,
      limit,
      offset,
      tookMs: Number((now() - started).toFixed(1)),
      facets: { tags: {}, sources: {} },
      exactCount: 0,
      relatedCount: 0,
      suggestionCount: 0,
      fallbackStage: 0,
      stagesRun: [],
      sources: [],
      sourcesCompleted: 0,
      sourcesPending: 0,
      sourcesFailed: 0,
      searching: false,
      cached: false,
      cachedAt: null,
      deep,
    };
  }

  // --- The cascade -----------------------------------------------------------

  private async runCascade(
    query: string,
    cls: QueryClassification,
    ctxBase: ProviderContext,
    queryId: string,
  ): Promise<CascadeOutcome> {
    const acc: UnifiedResult[] = [];
    const reports: ProviderRunReport[] = [];
    const stagesRun: string[] = [];
    let fallbackStage = 0;

    const supports = (p: SearchProvider) =>
      p.supportedQueryTypes.length === 0 || p.supportedQueryTypes.includes(cls.type);

    const runStage = async (
      name: string,
      tasks: Array<{ provider: SearchProvider; q: string }>,
      // Cap concurrent provider calls per stage. Stage 1 fans out to every
      // supported provider once, so it needs headroom for the full roster;
      // the expansion / pivot stages multiply by query variants and stay tight.
      maxTasks = 12,
    ): Promise<void> => {
      const seen = new Set<string>();
      const unique = tasks.filter((t) => {
        const k = `${t.provider.name}::${t.q.toLowerCase()}`;
        if (seen.has(k) || !t.q.trim()) return false;
        seen.add(k);
        return true;
      });
      if (unique.length === 0) return;
      stagesRun.push(name);
      fallbackStage = Math.max(fallbackStage, STAGE_NUMBER[name] ?? fallbackStage);
      const settled = await Promise.all(
        unique
          .slice(0, maxTasks)
          .map((t) => runProvider(t.provider, t.q, ctxBase, { breakers: this.breakers, logger: this.deps.logger, queryId })),
      );
      for (const { results, report } of settled) {
        reports.push(report);
        for (const r of results) acc.push(r);
      }
    };

    const fast = this.deps.providers.filter(
      (p) =>
        ['local', 'general_web', 'reference', 'code', 'academic'].includes(p.category) &&
        supports(p),
    );
    const archives = this.deps.providers.filter(
      (p) => ['archives', 'infrastructure'].includes(p.category) && supports(p),
    );

    const norm = normalizeWhitespace(query);
    const stage1Queries = [query, ...(norm.toLowerCase() !== query.toLowerCase() ? [norm] : [])];

    // STAGE 1 — exact / high confidence
    await runStage(
      'exact',
      fast.flatMap((p) => stage1Queries.map((q) => ({ provider: p, q }))),
      Math.max(24, fast.length * stage1Queries.length),
    );
    if (!ctxBase.deep && !insufficient(this.snapshot(acc), query)) {
      return this.finish(acc, reports, stagesRun, fallbackStage);
    }

    // STAGE 2 — query expansion
    const variants = expandQuery(query, cls).slice(0, ctxBase.deep ? 6 : 3);
    await runStage(
      'expansion',
      fast.flatMap((p) => variants.map((q) => ({ provider: p, q }))),
    );
    if (!ctxBase.deep && !insufficient(this.snapshot(acc), query)) {
      return this.finish(acc, reports, stagesRun, fallbackStage);
    }

    // STAGE 3 — broader discovery (archives, CT logs, vulnerability databases)
    await runStage(
      'discovery',
      archives.flatMap((p) => [
        { provider: p, q: query },
        ...(cls.entities.rootDomain ? [{ provider: p, q: cls.entities.rootDomain }] : []),
      ]),
      Math.max(16, archives.length * 2),
    );
    if (!ctxBase.deep && !insufficient(this.snapshot(acc), query)) {
      return this.finish(acc, reports, stagesRun, fallbackStage);
    }

    // STAGE 4 — domain / entity pivoting
    const pivots = this.entityPivots(cls);
    if (pivots.length > 0) {
      await runStage(
        'pivot',
        [...fast, ...archives].flatMap((p) =>
          pivots
            .filter((pivot) => !pivot.types || pivot.types.includes(p.category))
            .map((pivot) => ({ provider: p, q: pivot.q })),
        ),
      );
    }

    return this.finish(acc, reports, stagesRun, fallbackStage);
  }

  private snapshot(acc: UnifiedResult[]): UnifiedResult[] {
    return dedupe(acc).merged;
  }

  private finish(
    acc: UnifiedResult[],
    reports: ProviderRunReport[],
    stagesRun: string[],
    fallbackStage: number,
  ): CascadeOutcome {
    return { results: acc, reports, stagesRun, fallbackStage };
  }

  private entityPivots(
    cls: QueryClassification,
  ): Array<{ q: string; types?: string[] }> {
    const e = cls.entities;
    const out: Array<{ q: string; types?: string[] }> = [];
    if (cls.type === 'domain' || cls.type === 'url') {
      if (e.rootDomain) out.push({ q: e.rootDomain });
      if (e.hostname && e.hostname !== e.rootDomain) out.push({ q: e.hostname });
      if (e.pathTerms) out.push({ q: e.pathTerms, types: ['local', 'general_web', 'reference'] });
    }
    if (cls.type === 'email') {
      if (e.localPart) out.push({ q: e.localPart });
      if (e.rootDomain) out.push({ q: e.rootDomain, types: ['archives', 'infrastructure'] });
    }
    if (cls.type === 'username') {
      out.push({ q: cls.value, types: ['code', 'general_web', 'reference'] });
      out.push({ q: cls.value.replace(/[._-]/g, ' '), types: ['general_web', 'reference'] });
    }
    if (cls.type === 'repository' && e.repo) {
      out.push({ q: e.repo, types: ['code', 'general_web'] });
    }
    return out;
  }

  // --- Stage 5 — persist discovered public content --------------------------

  private async indexDiscoveries(results: UnifiedResult[], queryId: string): Promise<void> {
    const engine = this.deps.engine;
    if (!engine.upsert) return;
    const known = new Set<string>();
    if (engine.list) {
      for (const doc of engine.list()) if (doc.url) known.add(canonicalUrl(doc.url));
    }
    const candidates = results
      .filter(
        (r) =>
          r.kind === 'exact' &&
          (r.origin === 'web' || r.origin === 'code') &&
          r.url &&
          !known.has(canonicalUrl(r.url)),
      )
      .slice(0, 3);

    for (const candidate of candidates) {
      const url = candidate.url as string;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
        if (!this.deps.allowPrivateHosts && (await hostIsPrivate(parsed.hostname))) continue;
        const ua = this.deps.userAgent ?? 'BeaconSearchBot/1.0';
        const robots = await fetchRobots(parsed.origin, ua, this.deps.fetchImpl ?? fetch, 6000);
        if (!robots.isAllowed(parsed.pathname)) continue;
        const fetched = await fetchHtml(url, {
          userAgent: ua,
          timeoutMs: 8000,
          fetchImpl: this.deps.fetchImpl,
        });
        if ('error' in fetched) continue;
        const doc = extractReadable(fetched.html, fetched.finalUrl, ['discovered']);
        if (!doc || normalizeWhitespace(doc.body).length < 200) continue;
        engine.upsert({ ...doc, tags: [...new Set([...doc.tags, 'discovered'])] });
        this.deps.logger?.debug({ queryId, url: fetched.finalUrl }, 'discovery: indexed public page');
      } catch {
        /* discovery indexing is best-effort */
      }
    }
  }
}
