import type { AnswerConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { hostIsPrivate } from '../net-guard.js';
import { extractReadable, fetchHtml } from '../readable.js';
import { fetchRobots } from '../robots.js';
import type { RobotsRules } from '../robots.js';
import { normalizeWhitespace } from '../text.js';
import type { BeaconDocument, SearchQuery, SearchResponse } from '../types.js';
import { searchQuerySchema } from '../types.js';
import { classifyTrust } from './trust.js';
import type { TrustTier } from './types.js';
import type { WebSearchProvider } from './providers/web-search.js';

/** A source gathered for answering, with its full body text for extraction. */
export interface RetrievedSource {
  id: number;
  title: string;
  url?: string;
  origin: 'index' | 'web';
  domain?: string;
  trust: TrustTier;
  trustReason: string;
  live: boolean;
  retrievedAt: string;
  /** Plain body text, truncated. */
  text: string;
}

/** Minimal view of the search engine the retriever needs. */
export interface EngineLike {
  search(query: SearchQuery, options?: { combineWith?: 'AND' | 'OR' }): SearchResponse;
  get(id: string): BeaconDocument | undefined;
}

export interface GatherDeps {
  engine: EngineLike;
  webSearch: WebSearchProvider | null;
  config: AnswerConfig;
  userAgent: string;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  signal?: AbortSignal;
}

export interface GatherResult {
  sources: RetrievedSource[];
  warnings: string[];
}

const MAX_SOURCE_CHARS = 4000;
const TRUST_ORDER: Record<TrustTier, number> = {
  official: 0,
  established: 1,
  community: 2,
  unverified: 3,
};

function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.hostname}${path}${u.search}`;
  } catch {
    return url;
  }
}

function domainOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function fromIndex(query: string, deps: GatherDeps, limit: number): RetrievedSource[] {
  const parsed = searchQuerySchema.parse({ q: query, limit });
  // OR-combine: a natural-language question ("where do penguins live") rarely has
  // every token in one document. Relevance is re-checked when grounding claims.
  const response = deps.engine.search(parsed, { combineWith: 'OR' });
  const out: RetrievedSource[] = [];
  for (const hit of response.hits) {
    const doc = deps.engine.get(hit.id);
    if (!doc) continue;
    const text = normalizeWhitespace(doc.body).slice(0, MAX_SOURCE_CHARS);
    if (!text) continue;
    const trust = classifyTrust(doc.url, 'index', deps.config.trustedDomains);
    out.push({
      id: 0,
      title: doc.title,
      url: doc.url,
      origin: 'index',
      domain: domainOf(doc.url),
      trust: trust.tier,
      trustReason: trust.reason,
      live: false,
      retrievedAt: doc.updatedAt,
      text,
    });
  }
  return out;
}

async function fetchWebPage(
  result: { title: string; url: string; snippet?: string },
  deps: GatherDeps,
  robotsCache: Map<string, RobotsRules>,
): Promise<RetrievedSource | { error: string; url: string }> {
  const { config, userAgent, fetchImpl, signal } = deps;
  let parsed: URL;
  try {
    parsed = new URL(result.url);
  } catch {
    return { error: 'invalid URL', url: result.url };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: `unsupported protocol ${parsed.protocol}`, url: result.url };
  }
  if (!config.allowPrivateHosts && (await hostIsPrivate(parsed.hostname))) {
    return { error: 'private or loopback host (blocked)', url: result.url };
  }

  let robots = robotsCache.get(parsed.origin);
  if (!robots) {
    robots = await fetchRobots(parsed.origin, userAgent, fetchImpl ?? fetch, config.fetchTimeoutMs);
    robotsCache.set(parsed.origin, robots);
  }
  if (!robots.isAllowed(parsed.pathname)) {
    return { error: 'blocked by robots.txt', url: result.url };
  }

  const fetched = await fetchHtml(result.url, {
    userAgent,
    timeoutMs: config.fetchTimeoutMs,
    fetchImpl,
    signal,
  });
  if ('error' in fetched) return { error: fetched.error, url: result.url };

  const readable = extractReadable(fetched.html, fetched.finalUrl);
  const text = normalizeWhitespace(readable?.body ?? '').slice(0, MAX_SOURCE_CHARS);
  if (!text) return { error: 'no extractable content', url: result.url };

  const trust = classifyTrust(fetched.finalUrl, 'web', config.trustedDomains);
  return {
    id: 0,
    title: readable?.title || result.title || fetched.finalUrl,
    url: fetched.finalUrl,
    origin: 'web',
    domain: domainOf(fetched.finalUrl),
    trust: trust.tier,
    trustReason: trust.reason,
    live: true,
    retrievedAt: new Date().toISOString(),
    text,
  };
}

/**
 * Gather candidate sources for `query` from the local index and — when a web
 * search provider is configured — from the live web, fetched through the same
 * robots / SSRF-guard / timeout stack the crawler uses.
 */
export async function gatherSources(query: string, deps: GatherDeps): Promise<GatherResult> {
  const warnings: string[] = [];
  const { config } = deps;

  const indexSources = fromIndex(query, deps, Math.max(3, Math.ceil(config.maxSources / 2)));

  let webSources: RetrievedSource[] = [];
  if (!deps.webSearch) {
    warnings.push('web search is not configured — answering from the local index only');
  } else {
    try {
      const results = await deps.webSearch.search(query, config.maxSources, deps.signal);
      const robotsCache = new Map<string, RobotsRules>();
      const settled = await Promise.all(
        results.slice(0, config.maxSources).map((r) => fetchWebPage(r, deps, robotsCache)),
      );
      let unreachable = 0;
      for (const item of settled) {
        if ('error' in item) {
          unreachable += 1;
          deps.logger?.debug({ url: item.url, reason: item.error }, 'answer: source skipped');
        } else {
          webSources.push(item);
        }
      }
      if (unreachable > 0) {
        warnings.push(
          `${unreachable} web source${unreachable === 1 ? '' : 's'} could not be fetched or read`,
        );
      }
    } catch (error) {
      warnings.push(`web search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Dedupe: drop a web source whose URL matches an index source.
  const indexUrls = new Set(
    indexSources.map((s) => (s.url ? canonicalUrl(s.url) : '')).filter(Boolean),
  );
  const seen = new Set<string>(indexUrls);
  webSources = webSources.filter((s) => {
    const key = s.url ? canonicalUrl(s.url) : `web:${s.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const combined = [...indexSources, ...webSources]
    .sort((a, b) => TRUST_ORDER[a.trust] - TRUST_ORDER[b.trust])
    .slice(0, config.maxSources)
    .map((source, i) => ({ ...source, id: i + 1 }));

  return { sources: combined, warnings };
}
