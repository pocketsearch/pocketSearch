# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
