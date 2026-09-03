import type { Config } from '../../config.js';
import { createWebSearchProvider } from '../../answer/providers/web-search.js';
import type { SearchProvider } from '../types.js';
import type { LocalEngineLike } from './local.js';
import { CommonCrawlProvider } from './commoncrawl.js';
import { CrtShProvider } from './crtsh.js';
import { HackerNewsProvider } from './hackernews.js';
import { LocalIndexProvider } from './local.js';
import { WaybackProvider } from './wayback.js';
import { WebSearchAdapter } from './websearch.js';
import { WikipediaProvider } from './wikipedia.js';

export interface BuildProvidersDeps {
  engine: LocalEngineLike;
  config: Config;
  fetchImpl?: typeof fetch;
}

/**
 * Assemble every provider. Ones needing a key/URL that isn't set report
 * `configured=false` and are skipped by the orchestrator — search still works
 * with only the no-key sources (Wikipedia, Wayback, Common Crawl, HN, crt.sh).
 */
export function buildProviders(deps: BuildProvidersDeps): SearchProvider[] {
  const { config, fetchImpl } = deps;
  const timeoutMs = config.answer.fetchTimeoutMs;

  return [
    new LocalIndexProvider(deps.engine),
    new WebSearchAdapter(createWebSearchProvider(config.answer, fetchImpl), { timeoutMs }),
    new WikipediaProvider({ timeoutMs, fetchImpl }),
    new HackerNewsProvider({ timeoutMs, fetchImpl }),
    new WaybackProvider({ timeoutMs: timeoutMs + 2000, fetchImpl }),
    new CommonCrawlProvider({ timeoutMs: timeoutMs + 3000, fetchImpl }),
    new CrtShProvider({ timeoutMs: timeoutMs + 3000, fetchImpl }),
  ];
}
