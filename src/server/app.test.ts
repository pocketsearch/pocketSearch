import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { PersistentEngine } from '../core/store.js';
import { buildApp } from './app.js';

/** A fetch stub that keeps the discovery providers offline and deterministic. */
function offlineDiscoveryFetch(mode: 'empty' | 'throw' = 'empty'): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    if (mode === 'throw') throw new Error('network down');
    const url = String(input);
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (url.includes('collinfo.json')) {
      return json([{ id: 'CC', 'cdx-api': 'https://index.commoncrawl.org/CC-MAIN-index' }]);
    }
    if (url.includes('crt.sh') || url.includes('web.archive.org/cdx')) return json([]);
    return json({});
  }) as unknown as typeof fetch;
}

describe('HTTP API', () => {
  let app: FastifyInstance;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'beacon-test-'));
    const config = loadConfig({
      indexFile: path.join(dir, 'index.json'),
      webDir: path.join(dir, 'nonexistent-web'),
      logLevel: 'silent',
      persistDebounceMs: 0,
    });
    const logger = createLogger(config);
    const engine = new PersistentEngine({ indexFile: config.indexFile, debounceMs: 0, logger });
    await engine.load();
    app = await buildApp({ config, engine, logger });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('reports health identically on /health and /api/health', async () => {
    const api = await app.inject({ method: 'GET', url: '/api/health' });
    const bare = await app.inject({ method: 'GET', url: '/health' });
    expect(api.statusCode).toBe(200);
    expect(api.json()).toMatchObject({
      status: 'ok',
      documents: 0,
      plateChecks: expect.any(Object),
      answer: { enabled: true, webSearch: null, llm: [] },
    });
    expect(Object.keys(bare.json()).sort()).toEqual(Object.keys(api.json()).sort());
  });

  it('weaves an answer from the local index and cites its sources', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: {
        title: 'Fastify',
        body: 'Fastify is a fast and low-overhead web framework for Node.js. It focuses on developer experience and schema-based validation.',
        tags: [],
        url: 'https://fastify.dev/',
      },
    });

    const bad = await app.inject({ method: 'GET', url: '/api/answer?q=a' });
    expect(bad.statusCode).toBe(400);

    const res = await app.inject({ method: 'GET', url: '/api/answer?q=what%20is%20fastify' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.synthesizer).toBe('extractive');
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.sources[0].url).toBe('https://fastify.dev/');
    expect(['high', 'medium', 'low', 'none']).toContain(body.confidence);
    expect(body.warnings.join(' ')).toContain('web search is not configured');
  });

  it('returns 404 for /api/answer when answer synthesis is disabled', async () => {
    const config = loadConfig({
      indexFile: path.join(dir, 'index2.json'),
      webDir: path.join(dir, 'nonexistent-web'),
      logLevel: 'silent',
      persistDebounceMs: 0,
      answer: { enabled: false },
    });
    const engine = new PersistentEngine({ indexFile: config.indexFile, debounceMs: 0 });
    await engine.load();
    const disabled = await buildApp({ config, engine });
    await disabled.ready();
    try {
      const res = await disabled.inject({ method: 'GET', url: '/api/answer?q=anything here' });
      expect(res.statusCode).toBe(404);
      const health = await disabled.inject({ method: 'GET', url: '/api/health' });
      expect(health.json().answer).toEqual({ enabled: false, webSearch: null, llm: [] });
    } finally {
      await disabled.close();
    }
  });

  it('returns error:"not_found" for both unknown routes and missing resources', async () => {
    const route = await app.inject({ method: 'GET', url: '/api/nope' });
    const doc = await app.inject({ method: 'GET', url: '/api/documents/missing-id' });
    expect(route.statusCode).toBe(404);
    expect(doc.statusCode).toBe(404);
    expect(route.json().error).toBe('not_found');
    expect(doc.json().error).toBe('not_found');
  });

  it('creates, fetches, searches and deletes a document', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: {
        title: 'Fastify guide',
        body: 'Learn how to build APIs with Fastify.',
        tags: ['web'],
      },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id as string;

    const get = await app.inject({ method: 'GET', url: `/api/documents/${id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json().title).toBe('Fastify guide');

    const search = await app.inject({ method: 'GET', url: '/api/search?q=fastify' });
    expect(search.statusCode).toBe(200);
    expect(search.json().total).toBe(1);
    expect(search.json().hits[0].snippet).toContain('<mark>');

    const del = await app.inject({ method: 'DELETE', url: `/api/documents/${id}` });
    expect(del.statusCode).toBe(204);

    const missing = await app.inject({ method: 'GET', url: `/api/documents/${id}` });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects invalid input with 400 and issue details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: { body: 'no title' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
    expect(Array.isArray(res.json().issues)).toBe(true);
  });

  it('bulk indexes documents', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents/bulk',
      payload: {
        documents: [
          { title: 'Alpha', body: 'first', tags: ['x'] },
          { title: 'Beta', body: 'second', tags: ['x'] },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().indexed).toBe(2);

    const stats = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(stats.json().documents).toBe(2);
  });

  it('persists the index across engine restarts', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: { title: 'Persisted', body: 'still here', tags: [] },
    });
    await app.close();

    const config = loadConfig({
      indexFile: path.join(dir, 'index.json'),
      webDir: path.join(dir, 'nonexistent-web'),
      logLevel: 'silent',
      persistDebounceMs: 0,
    });
    const engine = new PersistentEngine({ indexFile: config.indexFile, debounceMs: 0 });
    await engine.load();
    expect(engine.size).toBe(1);
    app = await buildApp({ config, engine });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/search?q=persisted' });
    expect(res.json().total).toBe(1);
  });

  it('serves the API placeholder page when no web build exists', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Beacon Search API is running');
  });

  it('honours ?fuzzy=false in the query string (not a truthy string)', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: { title: 'Performance tuning', body: 'about performance', tags: [] },
    });
    // "perfrmance" only matches "performance" via fuzzy search.
    const fuzzy = await app.inject({ method: 'GET', url: '/api/search?q=perfrmance' });
    expect(fuzzy.json().total).toBe(1);
    const exact = await app.inject({ method: 'GET', url: '/api/search?q=perfrmance&fuzzy=false' });
    expect(exact.json().total).toBe(0);
  });

  it('runs offline plate checks and honours ?vehicle=false / ?mot=false', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/plate/LA51ABC?vehicle=false&mot=false',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.format).toBe('current');
    expect(body.region.office).toBe('Wimbledon');
    expect(body.summary.status).toBe('ok');
    const vehicleCheck = body.checks.find((c: { id: string }) => c.id === 'dvla-record');
    expect(vehicleCheck.status).toBe('skipped');
  });

  it('rejects a malformed plate as invalid, not "fail"', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/plate/check',
      payload: { plate: 'NOT-A-PLATE', vehicle: false, mot: false },
    });
    expect(res.json().valid).toBe(false);
    expect(res.json().summary.status).toBe('invalid');
  });

  it('plain /api/search is unchanged — a non-matching query still returns total 0', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=nothingmatchesthisxyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
    expect(res.json()).not.toHaveProperty('fallbackStage');
  });

  it('reports discovery providers on /api/health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json().discovery.enabled).toBe(true);
    expect(Array.isArray(res.json().discovery.providers)).toBe(true);
  });
});

describe('HTTP API — the search invariant (?fallback=1)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'beacon-fb-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function makeApp(mode: 'empty' | 'throw') {
    const config = loadConfig({
      indexFile: path.join(dir, `${mode}.json`),
      webDir: path.join(dir, 'no-web'),
      logLevel: 'silent',
      persistDebounceMs: 0,
      discovery: { crawlAndIndex: false, normalBudgetMs: 1500, deepBudgetMs: 3000 },
    });
    const engine = new PersistentEngine({ indexFile: config.indexFile, debounceMs: 0 });
    await engine.load();
    const app = await buildApp({ config, engine, fetchImpl: offlineDiscoveryFetch(mode) });
    await app.ready();
    return { app, engine };
  }

  it('never returns an empty result set for a valid query, even with an empty index', async () => {
    const { app } = await makeApp('empty');
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=' + encodeURIComponent('a totally unindexed phrase 12345') + '&fallback=1',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.hits.length).toBeGreaterThanOrEqual(1);
      expect(body.exactCount).toBe(0);
      expect(body.hits.every((h: { kind: string }) => h.kind === 'suggestion')).toBe(true);
      expect(body.hits[0].action.query).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it('returns local matches as exact results and still succeeds', async () => {
    const { app } = await makeApp('empty');
    try {
      await app.inject({
        method: 'POST',
        url: '/api/documents',
        payload: { title: 'Widgets handbook', body: 'all about widgets and gadgets', tags: ['docs'] },
      });
      const res = await app.inject({ method: 'GET', url: '/api/search?q=widgets&fallback=1' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.exactCount).toBeGreaterThanOrEqual(1);
      expect(body.hits[0].snippet).toContain('<mark>');
    } finally {
      await app.close();
    }
  });

  it('a total upstream outage does not 500 — it degrades to suggestions', async () => {
    const { app } = await makeApp('throw');
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=' + encodeURIComponent('resilient under total outage') + '&fallback=1&deep=1',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.hits.length).toBeGreaterThanOrEqual(1);
      expect(body.sourcesFailed).toBeGreaterThanOrEqual(1);
    } finally {
      await app.close();
    }
  });

  it('paginates via offset like the plain endpoint', async () => {
    const { app, engine } = await makeApp('empty');
    try {
      for (let i = 0; i < 25; i += 1) {
        engine.upsert({ title: `Widget note ${i}`, body: 'widget widget widget', tags: [], url: `https://w.test/${i}` });
      }
      const p1 = await app.inject({ method: 'GET', url: '/api/search?q=widget&fallback=1&limit=10&offset=0' });
      const p2 = await app.inject({ method: 'GET', url: '/api/search?q=widget&fallback=1&limit=10&offset=10' });
      expect(p1.json().hits.length).toBe(10);
      expect(p2.json().hits.length).toBeGreaterThan(0);
      expect(p1.json().total).toBe(p2.json().total);
      expect(p1.json().hits[0].id).not.toBe(p2.json().hits[0].id);
    } finally {
      await app.close();
    }
  });
});
