import type { Config } from '../../config.js';
import { createWebSearchProvider } from '../../answer/providers/web-search.js';
import type { SearchProvider } from '../types.js';
import type { LocalEngineLike } from './local.js';
import { CommonCrawlProvider } from './commoncrawl.js';
import { CrtShProvider } from './crtsh.js';
import { DuckDuckGoProvider } from './duckduckgo.js';
import { GitHubProvider } from './github.js';
import { HackerNewsProvider } from './hackernews.js';
import { LocalIndexProvider } from './local.js';
import { NominatimProvider } from './nominatim.js';
import { OpenAlexProvider } from './openalex.js';
import { NpmProvider, PyPiProvider } from './packages.js';
import {
  CisaKevProvider,
  GitHubAdvisoriesProvider,
  NvdProvider,
  OsvProvider,
} from './security.js';
import { StackExchangeProvider } from './stackexchange.js';
import { WaybackProvider } from './wayback.js';
import { WebSearchAdapter } from './websearch.js';
import { WikidataProvider } from './wikidata.js';
import { WikipediaProvider } from './wikipedia.js';

export interface BuildProvidersDeps {
  engine: LocalEngineLike;
  config: Config;
  fetchImpl?: typeof fetch;
}

/**
 * Assemble every provider. Ones needing a key/URL that isn't set report
 * `configured=false` and are skipped by the orchestrator — search still works
 * with only the no-key sources. Every provider below is keyless: the local
 * index, general reference (Wikipedia, Wikidata, DuckDuckGo), code + packages
 * (GitHub, Stack Overflow, npm, PyPI, Hacker News), academic (OpenAlex),
 * geography (OpenStreetMap), archives (Wayback, Common Crawl), and
 * infrastructure / vulnerability data (certificate transparency, OSV.dev,
 * GitHub Advisories, NVD, CISA KEV).
 */
export function buildProviders(deps: BuildProvidersDeps): SearchProvider[] {
  const { config, fetchImpl } = deps;
  const timeoutMs = config.answer.fetchTimeoutMs;
  const slow = timeoutMs + 3000;

  return [
    new LocalIndexProvider(deps.engine),
    new WebSearchAdapter(createWebSearchProvider(config.answer, fetchImpl), { timeoutMs }),
    new WikipediaProvider({ timeoutMs, fetchImpl }),
    new WikidataProvider({ timeoutMs, fetchImpl }),
    new DuckDuckGoProvider({ timeoutMs, fetchImpl }),
    new StackExchangeProvider({ timeoutMs, fetchImpl }),
    new GitHubProvider({ timeoutMs, fetchImpl }),
    new NpmProvider({ timeoutMs, fetchImpl }),
    new PyPiProvider({ timeoutMs, fetchImpl }),
    new OpenAlexProvider({ timeoutMs: slow, fetchImpl }),
    new NominatimProvider({ timeoutMs, fetchImpl }),
    new HackerNewsProvider({ timeoutMs, fetchImpl }),
    new WaybackProvider({ timeoutMs: slow, fetchImpl }),
    new CommonCrawlProvider({ timeoutMs: slow, fetchImpl }),
    new CrtShProvider({ timeoutMs: slow, fetchImpl }),
    new OsvProvider({ timeoutMs, fetchImpl }),
    new GitHubAdvisoriesProvider({ timeoutMs, fetchImpl }),
    new NvdProvider({ timeoutMs: slow, fetchImpl }),
    new CisaKevProvider({ timeoutMs: slow, fetchImpl }),
  ];
}
