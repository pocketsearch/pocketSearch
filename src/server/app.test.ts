import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { PersistentEngine } from '../core/store.js';
import { buildApp } from './app.js';

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

  it('reports health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', documents: 0 });
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
});
