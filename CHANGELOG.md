# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Discovery cascade** (`src/core/discovery/`): a search-orchestration layer
  that guarantees every non-empty query yields at least one renderable result.
  `GET /api/search?fallback=1` (used by the web UI) runs local index → web
  providers → query expansion → archives → entity pivots → related material →
  query suggestions, stopping as soon as the result set is no longer
  "insufficient" (`?deep=1` runs every stage). No-key providers: Wikipedia,
  Wayback Machine CDX, Common Crawl URL index, Hacker News, certificate
  transparency; the configured web-search provider (Brave/Tavily/SearXNG) is
  reused when set. Each provider has a per-call timeout, error isolation and a
  circuit breaker (`healthy`/`degraded`/`temporarily_disabled`/`rate_limited`/
  `misconfigured`); results are URL-canonicalised, deduped with `foundVia`
  provenance, and ranked with a rarity/diversity model that surfaces
  archive-only material. Results are cached (stale-served on total outage) and a
  thin normal search pre-computes the deep pass in the background. Discovered
  public pages are fetched (robots + SSRF-guarded) and added to the local index.
  Structured per-query logs; provider health on `GET /api/health`. See
  `docs/discovery.md`. Plain `GET /api/search` (no `fallback`) is unchanged.
- Web UI: a **Deep search** toggle, a "No exact matches — showing related
  discoveries" state that replaces the old empty "no documents matched" screen,
  progressive result counts (`… · searching more sources…`), `found via` source
  provenance, archived-capture badges, and a collapsible search-diagnostics
  panel. The zero-result dead end is no longer reachable for a valid query.

- **Answer weave** (`src/core/answer/`): `GET /api/answer?q=` and the Search tab
  return a short written answer for question-like queries, assembled only from
  retrieved sources. Retrieval combines the local index with optional live web
  search (`brave` / `tavily` / `searxng`), fetching each result through the
  crawler's `robots.txt` / SSRF-guard / timeout stack. Grounded sentences are
  woven into prose by an optional LLM (`ANTHROPIC_API_KEY`, or any
  OpenAI-compatible endpoint) and fall back to a deterministic weave otherwise.
  Every sentence is citation-checked; each source carries a trust tier, a
  retrieval timestamp and a reason, and an overall confidence banner is
  computed. See `docs/answers.md`. All configuration is optional.
- `src/core/readable.ts`: `fetchHtml` + `extractReadable`, the HTML-to-text
  helpers extracted from the crawler and now shared with answer retrieval.
- `SearchEngine.search` accepts an optional `{ combineWith: 'AND' | 'OR' }`.

- **UK number plate checker** (`src/core/plate/`): offline format classification
  (current / prefix / suffix / Northern Ireland / dateless), age-identifier
  decoding to a registration date range, and DVLA memory-tag → region/office
  lookup. Optional providers for the DVLA Vehicle Enquiry Service (tax & MOT
  status, vehicle details) and the DVSA MOT History API (full history, mileage
  anomaly detection). Exposed as `GET /api/plate/:reg`, `POST /api/plate/check`,
  the `beacon plate` CLI command, and a "Plate check" tab in the web UI.
- Plate checks can be indexed as searchable `plate-check` documents
  (`BEACON_PLATE_INDEX_RESULTS` or `?index=true`).
- **`beacon-mcp`** — a Model Context Protocol server (`@modelcontextprotocol/sdk`,
  stdio) exposing `check_number_plate`, `validate_plate_format`, `decode_plate`,
  `dvla_vehicle_enquiry`, `mot_history`, plus `beacon_search` /
  `beacon_index_document` / `beacon_stats` (which proxy a running HTTP API).
  Project-scoped `.mcp.json` and `docs/mcp.md` included.

### Changed

- The web UI now imports its API response types (`SearchResponse`, `IndexStats`,
  `BeaconDocument`, `PlateCheck`) directly from the backend via a `@core/*` path
  alias, instead of maintaining hand-copied duplicates that could drift. These
  are type-only imports, erased at build time — the bundle is byte-identical.
- Consistency pass (no behaviour change): `/health` and `/api/health` now return
  the same body; HTTP 404s always use `error: "not_found"`; one `fetchWithTimeout`
  helper backs every outbound request; one `slugify` backs ids and tags; the MCP
  server reuses the checker's provider instances (single MOT token cache); the
  DVLA/DVSA request timeout is configurable via `BEACON_PLATE_TIMEOUT_MS`; plate
  provider env vars also accept a `BEACON_` prefix; `readString` trims;
  `loadConfig` merges a partial `plate` override instead of replacing it.

### Fixed

- Boolean query-string params (`?fuzzy=`, `?prefix=`, `?vehicle=`, `?mot=`,
  `?index=`) were parsed with `z.coerce.boolean()`, so `?fuzzy=false` evaluated
  to `true`. Replaced with a param-aware coercion.
- Prefix-era age decoding placed T–Y registrations up to two years too late
  (e.g. a Y-reg shown as 2003); replaced the arithmetic with an explicit
  DVLA period table for both the prefix and suffix eras.
- `PlateCheck.summary.status` now distinguishes `invalid` (malformed mark) from
  `fail` (valid mark, a check failed) — an untaxed car with a valid plate is no
  longer reported as "invalid".
- MOT history: derive the current certificate expiry from the latest passed
  test (the trade API has no vehicle-level expiry field), so an expired MOT is
  actually flagged. Added a timeout to the OAuth token request.
- `PlateChecker.check` no longer throws on an unparseable `referenceDate`, and
  always emits a `dvla-record` / `mot-history` check line (skipped, with a
  reason) instead of silently omitting it.

## [1.0.0] - 2026-09-01

### Added

- In-memory full-text search engine (MiniSearch) with prefix/fuzzy matching,
  title and tag boosting, tag/source facets and highlighted snippets.
- Atomic, debounced JSON snapshot persistence with a versioned on-disk format.
- Fastify REST API: search, document CRUD, bulk import, stats, health, index
  clear, and website crawl.
- Built-in breadth-first web crawler with `robots.txt` support and configurable
  concurrency, delay and page budget.
- React + Vite single-page web UI: search with facets and pagination, add
  document form, crawl form, index status.
- `beacon` CLI: `serve`, `add`, `import`, `crawl`, `search`, `stats`.
- Zero-config environment-variable configuration with `.env` auto-loading.
- Multi-stage Dockerfile (non-root, health check) and `docker-compose.yml`.
- GitHub Actions CI: lint, typecheck, test, build, server + Docker smoke tests
  on Node 20 and 22.
