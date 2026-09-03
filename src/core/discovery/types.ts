/**
 * Types for the discovery layer — the orchestration that guarantees every
 * non-empty query produces at least one useful, renderable result.
 *
 * `UnifiedResult` is a superset of the local index's `SearchHit`, so the web UI
 * and API can render index hits, live web discoveries, archived pages and
 * generated search shortcuts through one model.
 */

export type ResultKind = 'exact' | 'related' | 'suggestion';

export type ResultOrigin = 'index' | 'web' | 'archive' | 'code' | 'academic' | 'generated';

export interface UnifiedResult {
  /** Stable id — hash of the canonical URL, or a synthetic id for generated rows. */
  id: string;
  kind: ResultKind;
  /** Final ranked score (higher is better). */
  score: number;
  /** HTML-safe title, may contain `<mark>` highlight tags. */
  title: string;
  url?: string;
  /** Human-friendly URL / breadcrumb for display. */
  displayUrl?: string;
  tags: string[];
  /** Primary source label (domain or provider). */
  source?: string;
  /** Every provider that surfaced this result, e.g. `['Local index', 'Wayback']`. */
  foundVia: string[];
  /** HTML-safe snippet, may contain `<mark>`. */
  snippet: string;
  /** Query terms used for highlighting. */
  terms: string[];
  origin: ResultOrigin;
  archived?: boolean;
  archivedDate?: string;
  /** For `suggestion` rows: the search this row runs when activated. */
  action?: { query: string; deep?: boolean; label?: string };
}

export type ProviderCategory =
  | 'local'
  | 'general_web'
  | 'archives'
  | 'code'
  | 'academic'
  | 'infrastructure'
  | 'reference';

export type QueryType =
  | 'phrase'
  | 'text'
  | 'person'
  | 'username'
  | 'email'
  | 'domain'
  | 'url'
  | 'ip'
  | 'organization'
  | 'repository'
  | 'doi'
  | 'academic_title'
  | 'filename'
  | 'hash'
  | 'cve';

export interface QueryClassification {
  type: QueryType;
  /** 0..1 */
  confidence: number;
  /** The normalized primary value (e.g. bare domain, email, username). */
  value: string;
  /** Extra components pulled from the query (hostname, root domain, path terms…). */
  entities: Record<string, string>;
}

export type ProviderStatus =
  | 'healthy'
  | 'degraded'
  | 'temporarily_disabled'
  | 'rate_limited'
  | 'misconfigured';

export interface ProviderContext {
  classification: QueryClassification;
  /** Overall deadline for the whole search — providers should respect it. */
  signal: AbortSignal;
  limit: number;
  deep: boolean;
  /** Active tag filters (applied to local-index results only). */
  tags: string[];
}

/** One upstream source of results. Implementations must never throw for an
 *  empty result set — they return `[]`, and the orchestrator widens the search. */
export interface SearchProvider {
  readonly name: string;
  readonly category: ProviderCategory;
  /** Lower runs first within a stage. */
  readonly priority: number;
  readonly timeoutMs: number;
  /** Query types this provider is useful for; empty = all. */
  readonly supportedQueryTypes: readonly QueryType[];
  /** Whether the provider has everything it needs (keys / URLs) to run. */
  readonly configured: boolean;
  search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]>;
}

export interface ProviderRunReport {
  name: string;
  category: ProviderCategory;
  status: ProviderStatus;
  ms: number;
  count: number;
  error?: string;
}

export interface OrchestratedResponse {
  query: string;
  normalizedQuery: string;
  queryType: QueryType;
  /** Paginated slice of the full ranked result set. */
  hits: UnifiedResult[];
  /** Size of the full ranked set (not just this page). */
  total: number;
  limit: number;
  offset: number;
  tookMs: number;
  facets: { tags: Record<string, number>; sources: Record<string, number> };
  exactCount: number;
  relatedCount: number;
  suggestionCount: number;
  /** Highest fallback stage reached (0 = local only … 6 = suggestions). */
  fallbackStage: number;
  stagesRun: string[];
  sources: ProviderRunReport[];
  sourcesCompleted: number;
  sourcesPending: number;
  sourcesFailed: number;
  /** True while a deeper pass is still running in the background. */
  searching: boolean;
  cached: boolean;
  cachedAt: string | null;
  deep: boolean;
}
