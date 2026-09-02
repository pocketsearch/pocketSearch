import type { AnswerConfig } from '../../config.js';
import { fetchWithTimeout } from '../../http.js';

export interface WebResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface WebSearchProvider {
  readonly name: string;
  readonly configured: boolean;
  search(query: string, limit: number, signal?: AbortSignal): Promise<WebResult[]>;
}

interface ProviderConfig {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** Brave Search API — https://brave.com/search/api/ (free tier available). */
export class BraveSearchProvider implements WebSearchProvider {
  readonly name = 'Brave Search';
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string | undefined, config: ProviderConfig) {
    this.apiKey = apiKey?.trim() || undefined;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async search(query: string, limit: number, signal?: AbortSignal): Promise<WebResult[]> {
    if (!this.apiKey) return [];
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}`;
    const response = await fetchWithTimeout(url, {
      headers: { accept: 'application/json', 'x-subscription-token': this.apiKey },
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      parentSignal: signal,
    });
    if (!response.ok) throw new Error(`Brave Search returned HTTP ${response.status}`);
    const body = (await response.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    return (body.web?.results ?? [])
      .filter((r): r is { title?: string; url: string; description?: string } => Boolean(r.url))
      .map((r) => ({ title: r.title ?? r.url, url: r.url, snippet: r.description }));
  }
}

/** Tavily Search API — https://tavily.com/ (search built for LLMs). */
export class TavilySearchProvider implements WebSearchProvider {
  readonly name = 'Tavily';
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string | undefined, config: ProviderConfig) {
    this.apiKey = apiKey?.trim() || undefined;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async search(query: string, limit: number, signal?: AbortSignal): Promise<WebResult[]> {
    if (!this.apiKey) return [];
    const response = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: Math.min(limit, 20),
        search_depth: 'basic',
      }),
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      parentSignal: signal,
    });
    if (!response.ok) throw new Error(`Tavily returned HTTP ${response.status}`);
    const body = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (body.results ?? [])
      .filter((r): r is { title?: string; url: string; content?: string } => Boolean(r.url))
      .map((r) => ({ title: r.title ?? r.url, url: r.url, snippet: r.content }));
  }
}

/** A self-hosted SearXNG instance with the JSON output format enabled. */
export class SearxngProvider implements WebSearchProvider {
  readonly name = 'SearXNG';
  private readonly baseUrl?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string | undefined, config: ProviderConfig) {
    this.baseUrl = baseUrl?.trim().replace(/\/+$/, '') || undefined;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.baseUrl);
  }

  async search(query: string, limit: number, signal?: AbortSignal): Promise<WebResult[]> {
    if (!this.baseUrl) return [];
    const url = `${this.baseUrl}/search?format=json&q=${encodeURIComponent(query)}`;
    const response = await fetchWithTimeout(url, {
      headers: { accept: 'application/json' },
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      parentSignal: signal,
    });
    if (!response.ok) throw new Error(`SearXNG returned HTTP ${response.status}`);
    const body = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (body.results ?? [])
      .filter((r): r is { title?: string; url: string; content?: string } => Boolean(r.url))
      .slice(0, limit)
      .map((r) => ({ title: r.title ?? r.url, url: r.url, snippet: r.content }));
  }
}

/**
 * Build the configured web search provider, or `null` when
 * `BEACON_ANSWER_WEB_SEARCH` is unset or its credentials are missing.
 */
export function createWebSearchProvider(
  config: AnswerConfig,
  fetchImpl?: typeof fetch,
): WebSearchProvider | null {
  const providerConfig: ProviderConfig = { timeoutMs: config.fetchTimeoutMs, fetchImpl };
  let provider: WebSearchProvider | null = null;
  switch (config.webSearch) {
    case 'brave':
      provider = new BraveSearchProvider(config.braveApiKey, providerConfig);
      break;
    case 'tavily':
      provider = new TavilySearchProvider(config.tavilyApiKey, providerConfig);
      break;
    case 'searxng':
      provider = new SearxngProvider(config.searxngUrl, providerConfig);
      break;
    default:
      return null;
  }
  return provider.configured ? provider : null;
}
