import { describe, expect, it, vi } from 'vitest';
import { loadConfig, type AnswerConfig } from '../config.js';
import { SearchEngine } from '../search-engine.js';
import { AnswerService } from './answer-service.js';
import type { LlmSynthesizer } from './providers/llm.js';
import type { WebSearchProvider } from './providers/web-search.js';

function answerConfig(overrides: Partial<AnswerConfig> = {}): AnswerConfig {
  return loadConfig({ answer: overrides }).answer;
}

function engineWith(docs: Array<{ title: string; body: string; url?: string }>): SearchEngine {
  const engine = new SearchEngine();
  for (const doc of docs) engine.upsert({ ...doc, tags: [] });
  return engine;
}

const PENGUIN_DOC = {
  title: 'Penguins',
  body: 'Penguins are flightless birds. They live almost exclusively in the Southern Hemisphere, especially around Antarctica. Their diet is mainly fish and krill.',
  url: 'https://en.wikipedia.org/wiki/Penguin',
};

describe('AnswerService', () => {
  it('returns a non-empty "none" answer when nothing is retrieved', async () => {
    const service = new AnswerService({
      engine: engineWith([]),
      config: answerConfig(),
      userAgent: 'test',
      webSearch: null,
      synthesizers: [],
    });
    const res = await service.answer('what is the airspeed of an unladen swallow');
    expect(res.confidence).toBe('none');
    expect(res.answer.length).toBeGreaterThan(0);
    expect(res.disclaimer).toBeTruthy();
    expect(res.sources).toEqual([]);
    expect(res.warnings.join(' ')).toContain('web search is not configured');
  });

  it('weaves index extracts deterministically when no LLM is configured', async () => {
    const service = new AnswerService({
      engine: engineWith([PENGUIN_DOC]),
      config: answerConfig(),
      userAgent: 'test',
      webSearch: null,
      synthesizers: [],
    });
    const res = await service.answer('where do penguins live');
    expect(res.synthesizer).toBe('extractive');
    expect(res.claims.length).toBeGreaterThan(0);
    expect(res.claims[0]?.sourceIds).toContain(1);
    expect(res.answer.toLowerCase()).toContain('hemisphere');
    expect(res.sources[0]?.trust).toBe('established');
    expect(res.sources[0]?.live).toBe(false);
  });

  it('uses a configured LLM synthesizer and verifies its citations', async () => {
    const llm: LlmSynthesizer = {
      name: 'StubLLM',
      kind: 'llm-anthropic',
      configured: true,
      weave: vi.fn(
        async ({ extracts }) => `Penguins live in the Southern Hemisphere [${extracts[0]?.id}].`,
      ),
    };
    const service = new AnswerService({
      engine: engineWith([PENGUIN_DOC]),
      config: answerConfig(),
      userAgent: 'test',
      webSearch: null,
      synthesizers: [llm],
    });
    const res = await service.answer('where do penguins live');
    expect(llm.weave).toHaveBeenCalled();
    expect(res.synthesizer).toBe('llm-anthropic');
    expect(res.claims[0]?.supported).toBe(true);
    expect(res.confidence).toBe('medium');
  });

  it('falls back to the extractive weave when the LLM throws', async () => {
    const llm: LlmSynthesizer = {
      name: 'StubLLM',
      kind: 'llm-anthropic',
      configured: true,
      weave: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const service = new AnswerService({
      engine: engineWith([PENGUIN_DOC]),
      config: answerConfig(),
      userAgent: 'test',
      webSearch: null,
      synthesizers: [llm],
    });
    const res = await service.answer('where do penguins live');
    expect(res.synthesizer).toBe('extractive');
    expect(res.warnings.join(' ')).toContain('StubLLM synthesis failed');
  });

  it('serves a repeated query from cache', async () => {
    const service = new AnswerService({
      engine: engineWith([PENGUIN_DOC]),
      config: answerConfig(),
      userAgent: 'test',
      webSearch: null,
      synthesizers: [],
    });
    const first = await service.answer('where do penguins live');
    const second = await service.answer('where do penguins live');
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
  });

  it('fetches a live web source through the robots / fetch stack', async () => {
    const webSearch: WebSearchProvider = {
      name: 'StubSearch',
      configured: true,
      search: async () => [
        { title: 'Penguin facts', url: 'https://fake.example/penguins', snippet: '' },
      ],
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      return new Response(
        `<html><head><title>Penguin facts</title></head><body><main>Penguins live in the Southern Hemisphere and eat fish.</main></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    }) as unknown as typeof fetch;

    const service = new AnswerService({
      engine: engineWith([]),
      config: answerConfig({ allowPrivateHosts: true }),
      userAgent: 'test',
      webSearch,
      synthesizers: [],
      fetchImpl,
    });
    const res = await service.answer('where do penguins live');
    expect(res.sources).toHaveLength(1);
    expect(res.sources[0]?.origin).toBe('web');
    expect(res.sources[0]?.live).toBe(true);
    expect(res.claims.length).toBeGreaterThan(0);
  });

  it('blocks a web source on a private host and records a warning', async () => {
    const webSearch: WebSearchProvider = {
      name: 'StubSearch',
      configured: true,
      search: async () => [{ title: 'internal', url: 'http://127.0.0.1/secrets', snippet: '' }],
    };
    const fetchImpl = vi.fn(
      async () => new Response('', { status: 200 }),
    ) as unknown as typeof fetch;
    const service = new AnswerService({
      engine: engineWith([]),
      config: answerConfig(),
      userAgent: 'test',
      webSearch,
      synthesizers: [],
      fetchImpl,
    });
    const res = await service.answer('what is the internal secret value here');
    expect(res.sources).toEqual([]);
    expect(res.warnings.join(' ')).toMatch(/could not be fetched/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
