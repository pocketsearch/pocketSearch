import { fetchWithTimeout } from '../../http.js';
import type { Logger } from '../../logger.js';
import type {
  ProviderContext,
  ProviderRunReport,
  ProviderStatus,
  SearchProvider,
  UnifiedResult,
} from '../types.js';

/**
 * Per-provider circuit breaker. After `failureThreshold` consecutive failures the
 * breaker opens and the provider is skipped until `coolDownMs` has passed, then it
 * is tried once (half-open). A success closes it again.
 */
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt = 0;
  private lastError: string | undefined;
  private rateLimited = false;

  constructor(
    private readonly failureThreshold = 3,
    private readonly coolDownMs = 60_000,
  ) {}

  get status(): ProviderStatus {
    if (this.rateLimited) return 'rate_limited';
    if (this.isOpen()) return 'temporarily_disabled';
    if (this.consecutiveFailures > 0) return 'degraded';
    return 'healthy';
  }

  get error(): string | undefined {
    return this.lastError;
  }

  isOpen(): boolean {
    if (this.consecutiveFailures < this.failureThreshold) return false;
    return Date.now() - this.openedAt < this.coolDownMs;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.lastError = undefined;
    this.rateLimited = false;
  }

  recordFailure(error: string, opts: { rateLimited?: boolean } = {}): void {
    this.consecutiveFailures += 1;
    this.lastError = error;
    this.rateLimited = Boolean(opts.rateLimited);
    if (this.consecutiveFailures >= this.failureThreshold) this.openedAt = Date.now();
  }
}

export interface RunOptions {
  breakers: Map<string, CircuitBreaker>;
  logger?: Logger;
  queryId: string;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Run one provider with timeout + circuit-breaker + full error isolation.
 *  Never throws — always resolves to `{ results, report }`. */
export async function runProvider(
  provider: SearchProvider,
  query: string,
  ctx: ProviderContext,
  opts: RunOptions,
): Promise<{ results: UnifiedResult[]; report: ProviderRunReport }> {
  const started = now();
  let breaker = opts.breakers.get(provider.name);
  if (!breaker) {
    breaker = new CircuitBreaker();
    opts.breakers.set(provider.name, breaker);
  }

  const base: Omit<ProviderRunReport, 'status' | 'ms' | 'count'> = {
    name: provider.name,
    category: provider.category,
  };

  if (!provider.configured) {
    return {
      results: [],
      report: { ...base, status: 'misconfigured', ms: 0, count: 0, error: 'not configured' },
    };
  }
  if (breaker.isOpen()) {
    opts.logger?.debug(
      { queryId: opts.queryId, provider: provider.name },
      'discovery: provider skipped (circuit open)',
    );
    return {
      results: [],
      report: {
        ...base,
        status: 'temporarily_disabled',
        ms: 0,
        count: 0,
        error: breaker.error ?? 'circuit open',
      },
    };
  }

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), provider.timeoutMs);
  const onParentAbort = () => timeout.abort();
  ctx.signal.addEventListener('abort', onParentAbort, { once: true });

  // Race the provider against the deadline so a provider that ignores its
  // `AbortSignal` still can't stall the whole search.
  const deadline = new Promise<never>((_, reject) => {
    if (timeout.signal.aborted) reject(new Error(`timed out after ${provider.timeoutMs}ms`));
    timeout.signal.addEventListener(
      'abort',
      () => reject(new Error(`timed out after ${provider.timeoutMs}ms`)),
      { once: true },
    );
  });

  try {
    const providerCall = provider.search(query, { ...ctx, signal: timeout.signal });
    // If the deadline wins the race, the provider promise is left floating — keep
    // its eventual rejection from surfacing as an unhandled rejection.
    providerCall.catch(() => undefined);
    const results = await Promise.race([providerCall, deadline]);
    breaker.recordSuccess();
    const ms = Math.round(now() - started);
    opts.logger?.debug(
      { queryId: opts.queryId, provider: provider.name, ms, count: results.length },
      'discovery: provider ok',
    );
    return { results, report: { ...base, status: 'healthy', ms, count: results.length } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const rateLimited = /\b429\b|rate limit/i.test(message);
    breaker.recordFailure(message, { rateLimited });
    const ms = Math.round(now() - started);
    opts.logger?.debug(
      { queryId: opts.queryId, provider: provider.name, ms, err: message },
      'discovery: provider failed',
    );
    return {
      results: [],
      report: { ...base, status: breaker.status, ms, count: 0, error: message },
    };
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener('abort', onParentAbort);
  }
}

export interface JsonFetchOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

/** GET + JSON with a helpful error on non-2xx (so the breaker sees the status). */
export async function fetchJson<T>(url: string, opts: JsonFetchOptions): Promise<T> {
  const response = await fetchWithTimeout(url, {
    headers: { accept: 'application/json', ...opts.headers },
    timeoutMs: opts.timeoutMs,
    parentSignal: opts.signal,
    fetchImpl: opts.fetchImpl,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  }
  return (await response.json()) as T;
}

/** GET + text (CDX endpoints return newline JSON / plain formats). */
export async function fetchText(url: string, opts: JsonFetchOptions): Promise<string> {
  const response = await fetchWithTimeout(url, {
    headers: { ...opts.headers },
    timeoutMs: opts.timeoutMs,
    parentSignal: opts.signal,
    fetchImpl: opts.fetchImpl,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  }
  return response.text();
}
