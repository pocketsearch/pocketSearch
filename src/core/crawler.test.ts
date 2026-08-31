import { describe, expect, it, vi } from 'vitest';
import { crawl } from './crawler.js';

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

const PAGES: Record<string, string> = {
  'https://site.test/': `<!doctype html><html><head><title>Home</title></head>
    <body><main><h1>Home</h1><p>Welcome to the test site about penguins.</p>
    <a href="/about">About</a> <a href="/blog/1">Post</a>
    <a href="https://other.test/x">External</a></main></body></html>`,
  'https://site.test/about': `<html><head><title>About</title></head>
    <body><main>We write about penguins and search engines.</main></body></html>`,
  'https://site.test/blog/1': `<html><head><title>Post One</title></head>
    <body><main>Deep dive into penguin migration patterns.</main></body></html>`,
};

function makeFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    const page = PAGES[url];
    if (page) return htmlResponse(page);
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

const baseOptions = {
  maxPages: 10,
  sameOriginOnly: true,
  tags: ['test'],
  userAgent: 'BeaconSearchBot/1.0',
  timeoutMs: 1000,
  delayMs: 0,
  concurrency: 2,
  allowPrivateHosts: true,
};

describe('crawl', () => {
  it('crawls same-origin pages and extracts documents', async () => {
    const result = await crawl(
      { ...baseOptions, url: 'https://site.test/' },
      { fetchImpl: makeFetch() },
    );
    expect(result.pagesCrawled).toBe(3);
    const urls = result.pages.map((p) => p.url).sort();
    expect(urls).toEqual([
      'https://site.test/',
      'https://site.test/about',
      'https://site.test/blog/1',
    ]);
    expect(result.pages[0]?.tags).toEqual(['test']);
    expect(result.pages.find((p) => p.url === 'https://site.test/about')?.body).toContain(
      'penguins',
    );
  });

  it('honours maxPages', async () => {
    const result = await crawl(
      { ...baseOptions, url: 'https://site.test/', maxPages: 1 },
      { fetchImpl: makeFetch() },
    );
    expect(result.pagesCrawled).toBe(1);
  });

  it('invokes the onPage callback for each page', async () => {
    const onPage = vi.fn();
    await crawl({ ...baseOptions, url: 'https://site.test/' }, { fetchImpl: makeFetch(), onPage });
    expect(onPage).toHaveBeenCalledTimes(3);
  });

  it('records fetch errors', async () => {
    const result = await crawl(
      { ...baseOptions, url: 'https://site.test/missing' },
      { fetchImpl: makeFetch() },
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.error).toContain('404');
  });

  it('refuses to crawl private hosts unless explicitly allowed', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await crawl(
      { ...baseOptions, url: 'http://127.0.0.1:8080/', allowPrivateHosts: false },
      { fetchImpl },
    );
    expect(result.pagesCrawled).toBe(0);
    expect(result.errors[0]?.error).toContain('private or loopback');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips pages disallowed by robots.txt', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /about', { status: 200 });
      }
      const page = PAGES[url];
      return page ? htmlResponse(page) : new Response('nf', { status: 404 });
    }) as unknown as typeof fetch;

    const result = await crawl({ ...baseOptions, url: 'https://site.test/' }, { fetchImpl });
    expect(result.skipped.some((s) => s.url === 'https://site.test/about')).toBe(true);
    expect(result.pages.some((p) => p.url === 'https://site.test/about')).toBe(false);
  });
});
