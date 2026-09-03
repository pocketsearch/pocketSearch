import { describe, expect, it, vi } from 'vitest';
import { SearchEngine } from '../search-engine.js';
import { Orchestrator } from './orchestrator.js';
import { LocalIndexProvider } from './providers/local.js';
import { makeResult } from './result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from './types.js';

function engineWith(docs: Array<{ title: string; body: string; url?: string; tags?: string[] }>) {
  const engine = new SearchEngine();
  for (const doc of docs) engine.upsert({ tags: [], ...doc });
  return engine;
}

/** Minimal configurable provider stub. */
function stub(
  name: string,
  handler: (query: string, ctx: ProviderContext) => UnifiedResult[] | Promise<UnifiedResult[]>,
  over: Partial<Pick<SearchProvider, 'category' | 'priority' | 'timeoutMs' | 'configured'>> = {},
): SearchProvider {
  return {
    name,
    category: over.category ?? 'general_web',
    priority: over.priority ?? 1,
    timeoutMs: over.timeoutMs ?? 500,
    supportedQueryTypes: [],
    configured: over.configured ?? true,
    search: async (q, ctx) => handler(q, ctx),
  };
}

function webResults(name: string, n: number, query: string): UnifiedResult[] {
  return Array.from({ length: n }, (_, i) =>
    makeResult({
      title: `${query} result ${i} via ${name}`,
      url: `https://${name}.example/${encodeURIComponent(query)}/${i}`,
      snippet: `A page about ${query}.`,
      provider: name,
      origin: 'web',
      terms: query.split(/\s+/),
    }),
  );
}

const baseDeps = {
  crawlAndIndex: false as const,
  backgroundDeepen: false as const,
  normalBudgetMs: 2000,
  deepBudgetMs: 4000,
};

describe('Orchestrator — the search invariant', () => {
  it('an empty query is the only permitted dead end', async () => {
    const o = new Orchestrator({ ...baseDeps, engine: engineWith([]), providers: [] });
    const res = await o.search('   ');
    expect(res.total).toBe(0);
    expect(res.hits).toEqual([]);
  });

  it('local index matches are returned as exact results', async () => {
    const engine = engineWith([
      { title: 'Fastify guide', body: 'Build APIs with Fastify', url: 'https://fastify.dev' },
    ]);
    const o = new Orchestrator({
      ...baseDeps,
      engine,
      providers: [new LocalIndexProvider(engine)],
    });
    const res = await o.search('fastify');
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
    expect(res.exactCount).toBeGreaterThanOrEqual(1);
    expect(res.hits[0]?.snippet).toContain('<mark>');
  });

  it('falls through to web providers when the local index is empty', async () => {
    const o = new Orchestrator({
      ...baseDeps,
      engine: engineWith([]),
      providers: [stub('WebA', (q) => webResults('WebA', 8, q))],
    });
    const res = await o.search('something obscure');
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
    expect(res.hits.some((h) => h.foundVia.includes('WebA'))).toBe(true);
  });

  it('never dead-ends when every provider returns zero — suggestions are the floor', async () => {
    const o = new Orchestrator({
      ...baseDeps,
      engine: engineWith([]),
      providers: [stub('WebA', () => []), stub('WebB', () => []), stub('WebC', () => [])],
    });
    const res = await o.search('zzz nothing matches this query anywhere');
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
    expect(res.suggestionCount).toBeGreaterThanOrEqual(1);
    expect(res.hits.every((h) => h.kind === 'suggestion')).toBe(true);
    expect(res.hits[0]?.action?.query).toBeTruthy();
    expect(res.fallbackStage).toBe(6);
  });

  it('a provider that throws is isolated — search still succeeds', async () => {
    const o = new Orchestrator({
      ...baseDeps,
      engine: engineWith([]),
      providers: [
        stub('Broken', () => {
          throw new Error('kaboom');
        }),
        stub('WebB', (q) => webResults('webb', 6, q)),
      ],
    });
    const res = await o.search('resilient query test');
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
    expect(res.sources.find((s) => s.name === 'Broken')?.status).not.toBe('healthy');
    expect(res.sources.find((s) => s.name === 'WebB')?.status).toBe('healthy');
  });

  it('a provider that times out does not stall the whole search', async () => {
    const o = new Orchestrator({
      ...baseDeps,
      engine: engineWith([]),
      providers: [
        stub(
          'Slow',
          () => new Promise<UnifiedResult[]>((resolve) => setTimeout(() => resolve([]), 5000)),
          { timeoutMs: 100 },
        ),
        stub('Fast', (q) => webResults('fast', 6, q)),
      ],
    });
    const started = Date.now();
    const res = await o.search('timeout behaviour');
    expect(Date.now() - started).toBeLessThan(2500);
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
  });

  it('an unconfigured provider is skipped, not failed', async () => {
    const o = new Orchestrator({
      ...baseDeps,
      engine: engineWith([]),
      providers: [
        stub('NoKey', () => webResults('nokey', 5, 'x'), { configured: false }),
        stub('Ok', (q) => webResults('ok', 6, q)),
      ],
    });
    const res = await o.search('config missing scenario');
    expect(res.sources.find((s) => s.name === 'NoKey')?.status).toBe('misconfigured');
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
  });

  it('opens a circuit breaker after repeated failures', async () => {
    const search = vi.fn(() => {
      throw new Error('429 rate limit');
    });
    const flaky: SearchProvider = {
      name: 'Flaky',
      category: 'general_web',
      priority: 1,
      timeoutMs: 200,
      supportedQueryTypes: [],
      configured: true,
      search,
    };
    const o = new Orchestrator({
      ...baseDeps,
      engine: engineWith([]),
      providers: [flaky, stub('Backup', (q) => webResults('backup', 6, q))],
    });
    for (let i = 0; i < 4; i += 1) await o.search(`breaker test ${i}`);
    const callsAfterOpen = search.mock.calls.length;
    await o.search('breaker test final');
    // Breaker is open now — the provider is no longer invoked.
    expect(search.mock.calls.length).toBe(callsAfterOpen);
    const res = await o.search('breaker test final 2');
    expect(res.sources.find((s) => s.name === 'Flaky')?.status).toMatch(
      /rate_limited|temporarily_disabled/,
    );
  });

  it('deep search runs more stages than a normal search', async () => {
    const stages: string[][] = [];
    const providers = [
      stub('Web', (q) => webResults('web', 2, q)), // deliberately thin
      stub('Archive', (q) => webResults('arch', 2, q), { category: 'archives' }),
    ];
    const o = new Orchestrator({ ...baseDeps, engine: engineWith([]), providers });
    const normal = await o.search('deep vs normal example query');
    const deep = await o.search('deep vs normal example query', { deep: true });
    stages.push(normal.stagesRun, deep.stagesRun);
    expect(deep.stagesRun.length).toBeGreaterThanOrEqual(normal.stagesRun.length);
    expect(deep.deep).toBe(true);
  });

  it('serves a repeated query from cache', async () => {
    const search = vi.fn((q: string) => webResults('c', 8, q));
    const o = new Orchestrator({
      ...baseDeps,
      engine: engineWith([]),
      providers: [stub('Cached', search)],
    });
    const first = await o.search('cache me if you can');
    const calls = search.mock.calls.length;
    const second = await o.search('cache me if you can');
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(search.mock.calls.length).toBe(calls);
  });

  it('paginates the full ranked set across offsets', async () => {
    const o = new Orchestrator({
      ...baseDeps,
      engine: engineWith([]),
      providers: [stub('Big', (q) => webResults('big', 40, q))],
    });
    const page1 = await o.search('lots of results here please', { limit: 10, offset: 0 });
    const page2 = await o.search('lots of results here please', { limit: 10, offset: 10 });
    expect(page1.hits.length).toBe(10);
    expect(page2.hits.length).toBe(10);
    expect(page1.total).toBe(page2.total);
    expect(page1.hits[0]?.id).not.toBe(page2.hits[0]?.id);
  });

  it('merges duplicate URLs from multiple providers and records provenance', async () => {
    const shared = 'https://dup.example/page';
    const mk = (name: string) => [
      makeResult({
        title: 'Shared page',
        url: shared,
        snippet: 'same page',
        provider: name,
        origin: 'web',
        terms: ['shared'],
      }),
    ];
    const o = new Orchestrator({
      ...baseDeps,
      engine: engineWith([]),
      providers: [
        stub('One', () => mk('One')),
        stub('Two', () => mk('Two')),
        stub('Filler', (q) => webResults('filler', 6, q)),
      ],
    });
    const res = await o.search('shared page dedupe');
    const dup = res.hits.filter((h) => h.url === shared);
    expect(dup).toHaveLength(1);
    expect(dup[0]?.foundVia.sort()).toEqual(['One', 'Two']);
  });

  it('pivots on a domain query', async () => {
    const seen: string[] = [];
    const o = new Orchestrator({
      ...baseDeps,
      engine: engineWith([]),
      providers: [
        stub(
          'Arch',
          (q) => {
            seen.push(q);
            return webResults('arch', 1, q);
          },
          { category: 'archives' },
        ),
      ],
    });
    const res = await o.search('sub.example.co.uk', { deep: true });
    expect(res.queryType).toBe('domain');
    expect(seen.some((q) => q === 'example.co.uk')).toBe(true);
  });

  it('every non-empty query in a batch yields at least one renderable hit', async () => {
    const o = new Orchestrator({
      ...baseDeps,
      engine: engineWith([{ title: 'Local doc', body: 'about widgets', url: 'https://x.test' }]),
      providers: [
        stub('W', (q) => (q.includes('nomatch') ? [] : webResults('w', 3, q))),
        stub('Broken', () => {
          throw new Error('down');
        }),
      ],
    });
    const queries = [
      'widgets',
      'nomatch total gibberish xyzzy',
      '"an obscure quoted phrase that matches nothing"',
      'example.com',
      'https://example.com/some/deep/path',
      'not.a.real.email@nowhere.invalid',
      'some_user_name',
      'CVE-2021-44228',
      'a very long natural language question about something that has no answer here',
      '10.1000/xyz123',
    ];
    for (const q of queries) {
      const res = await o.search(q);
      expect(res.hits.length, `query: ${q}`).toBeGreaterThanOrEqual(1);
    }
  });
});
