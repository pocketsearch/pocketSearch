import * as cheerio from 'cheerio';
import type { Logger } from './logger.js';
import { hostIsPrivate } from './net-guard.js';
import { fetchRobots, RobotsRules } from './robots.js';
import { normalizeWhitespace } from './text.js';
import type { DocumentInput } from './types.js';

export interface CrawlOptions {
  url: string;
  maxPages: number;
  sameOriginOnly: boolean;
  tags: string[];
  userAgent: string;
  timeoutMs: number;
  delayMs: number;
  concurrency: number;
  respectRobots?: boolean;
  /** Allow crawling loopback / private / link-local hosts (SSRF guard). */
  allowPrivateHosts?: boolean;
}

export interface CrawlDeps {
  fetchImpl?: typeof fetch;
  logger?: Logger;
  /** Invoked for every successfully extracted page. */
  onPage?: (page: DocumentInput) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface CrawlResult {
  startUrl: string;
  pagesCrawled: number;
  pages: DocumentInput[];
  errors: Array<{ url: string; error: string }>;
  skipped: Array<{ url: string; reason: string }>;
}

const SKIP_EXTENSION =
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|pdf|zip|gz|tar|mp4|mp3|woff2?|ttf|eot)(\?|#|$)/i;

function extractPage(html: string, url: string, tags: string[]): DocumentInput | null {
  const $ = cheerio.load(html);
  $('script, style, noscript, template, svg, iframe').remove();
  // Ensure block-level elements are separated by whitespace in the text dump.
  $('h1, h2, h3, h4, h5, h6, p, li, br, div, section, article, header, footer, tr, td, th').append(
    ' ',
  );

  const title =
    normalizeWhitespace($('meta[property="og:title"]').attr('content') ?? '') ||
    normalizeWhitespace($('title').first().text()) ||
    normalizeWhitespace($('h1').first().text()) ||
    url;

  const main = $('main').first();
  const scope = main.length > 0 ? main : $('body');
  const body = normalizeWhitespace(scope.text());
  if (body.length === 0 && title === url) return null;

  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return undefined;
    }
  })();

  return {
    title: title.slice(0, 1024),
    body,
    url,
    tags,
    source: host,
  };
}

function collectLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const out = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl);
      resolved.hash = '';
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        out.add(resolved.toString());
      }
    } catch {
      /* ignore malformed hrefs */
    }
  });
  return [...out];
}

async function fetchText(
  url: string,
  userAgent: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  parentSignal?: AbortSignal,
): Promise<{ html: string; finalUrl: string } | { error: string }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html'))
      return { error: `unsupported content-type "${contentType}"` };
    return { html: await response.text(), finalUrl: response.url || url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Breadth-first crawl a website, extracting a searchable document per HTML page.
 * Honours robots.txt (for the configured user agent) unless disabled.
 */
export async function crawl(options: CrawlOptions, deps: CrawlDeps = {}): Promise<CrawlResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const logger = deps.logger;
  const start = new URL(options.url);
  const origin = start.origin;

  if (!options.allowPrivateHosts && (await hostIsPrivate(start.hostname))) {
    return {
      startUrl: start.toString(),
      pagesCrawled: 0,
      pages: [],
      errors: [
        {
          url: start.toString(),
          error:
            'refusing to crawl a private or loopback host; set BEACON_CRAWL_ALLOW_PRIVATE=true to override',
        },
      ],
      skipped: [],
    };
  }

  const robots =
    options.respectRobots === false
      ? new RobotsRules('', options.userAgent)
      : await fetchRobots(origin, options.userAgent, fetchImpl, options.timeoutMs);

  const result: CrawlResult = {
    startUrl: start.toString(),
    pagesCrawled: 0,
    pages: [],
    errors: [],
    skipped: [],
  };

  const seen = new Set<string>([start.toString()]);
  let frontier: string[] = [start.toString()];

  while (frontier.length > 0 && result.pagesCrawled < options.maxPages) {
    if (deps.signal?.aborted) break;
    const budget = options.maxPages - result.pagesCrawled;
    const batch = frontier.slice(0, Math.min(options.concurrency, budget));
    frontier = frontier.slice(batch.length);
    const discovered: string[] = [];

    await Promise.all(
      batch.map(async (pageUrl) => {
        const parsed = new URL(pageUrl);
        if (options.respectRobots !== false && !robots.isAllowed(parsed.pathname)) {
          result.skipped.push({ url: pageUrl, reason: 'blocked by robots.txt' });
          return;
        }
        if (!options.allowPrivateHosts && (await hostIsPrivate(parsed.hostname))) {
          result.skipped.push({ url: pageUrl, reason: 'private or loopback host' });
          return;
        }

        const fetched = await fetchText(
          pageUrl,
          options.userAgent,
          options.timeoutMs,
          fetchImpl,
          deps.signal,
        );
        if ('error' in fetched) {
          result.errors.push({ url: pageUrl, error: fetched.error });
          return;
        }

        result.pagesCrawled += 1;
        const page = extractPage(fetched.html, fetched.finalUrl, options.tags);
        if (page) {
          result.pages.push(page);
          await deps.onPage?.(page);
        } else {
          result.skipped.push({ url: pageUrl, reason: 'no extractable content' });
        }

        const $ = cheerio.load(fetched.html);
        for (const link of collectLinks($, fetched.finalUrl)) {
          if (seen.has(link) || SKIP_EXTENSION.test(link)) continue;
          if (options.sameOriginOnly && new URL(link).origin !== origin) continue;
          seen.add(link);
          discovered.push(link);
        }
      }),
    );

    frontier.push(...discovered);
    if (options.delayMs > 0 && frontier.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    logger?.debug({ crawled: result.pagesCrawled, queued: frontier.length }, 'crawl progress');
  }

  return result;
}
