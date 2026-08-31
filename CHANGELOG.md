# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
