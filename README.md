# 🔦 Beacon Search

A small, **fully open-source, self-hostable full-text search engine** with a web UI.
No database, no external services — the index lives in memory and is persisted to a
single JSON file. Runs anywhere Node.js 20+ runs, or as a Docker container.

- **Full-text search** with prefix + fuzzy matching, title/tag boosting, tag facets and highlighted snippets (powered by [MiniSearch](https://github.com/lucaong/minisearch)).
- **REST API** built on [Fastify](https://fastify.dev/) with schema validation.
- **Web UI** (React + Vite) for searching, adding documents and crawling sites.
- **Built-in crawler** that indexes a website's pages and respects `robots.txt`.
- **CLI** (`beacon`) for scripting: add, import, crawl, search, stats.
- **Zero-config**: every setting has a sane default. Point it at content and go.

---

## Quick start

### With Node.js

```bash
git clone https://github.com/abbieymatthews030-star/abeaconsearch.git
cd abeaconsearch
npm install
npm run build
npm start
# → http://localhost:7700
```

### With Docker

```bash
docker compose up --build
# → http://localhost:7700   (index persisted in the `beacon-data` volume)
```

or plain Docker:

```bash
docker build -t abeaconsearch .
docker run -p 7700:7700 -v beacon-data:/data abeaconsearch
```

### Development (API + UI with hot reload)

```bash
npm install
npm run dev
# API on :7700, Vite dev server on :5173 (proxies /api to :7700)
```

---

## Adding content

**Crawl a website** (from the UI's _Crawl site_ tab, or):

```bash
npm run cli -- crawl https://example.com --max-pages 100
```

**Import a JSON file** (array of documents, or `{ "documents": [...] }`):

```bash
npm run cli -- import examples/documents.sample.json
```

**Add one document via the API:**

```bash
curl -X POST http://localhost:7700/api/documents \
  -H 'content-type: application/json' \
  -d '{"title":"Hello","body":"world","tags":["demo"]}'
```

After building and installing globally (`npm link` or `npm i -g .`) the CLI is
available as `beacon`.

---

## HTTP API

| Method   | Path                  | Description                                          |
| -------- | --------------------- | ---------------------------------------------------- |
| `GET`    | `/api/health`         | Liveness + document count                            |
| `GET`    | `/api/stats`          | Index statistics, top tags/sources                   |
| `GET`    | `/api/search`         | `?q=&limit=&offset=&tags=&source=&fuzzy=&prefix=`    |
| `GET`    | `/api/documents`      | List documents (`?limit=&offset=`)                   |
| `GET`    | `/api/documents/:id`  | Fetch one document                                   |
| `POST`   | `/api/documents`      | Create/replace a document                            |
| `PUT`    | `/api/documents/:id`  | Replace a document by id                             |
| `DELETE` | `/api/documents/:id`  | Delete a document                                    |
| `POST`   | `/api/documents/bulk` | `{ "documents": [...] }`                             |
| `POST`   | `/api/crawl`          | `{ "url", "maxPages?", "sameOriginOnly?", "tags?" }` |
| `POST`   | `/api/index/clear`    | Remove all documents                                 |

### Search response

```jsonc
{
  "query": "fastify",
  "total": 1,
  "limit": 10,
  "offset": 0,
  "tookMs": 0.42,
  "hits": [
    {
      "id": "fastify-guide",
      "score": 3.14,
      "title": "<mark>Fastify</mark> guide",
      "url": "https://…",
      "tags": ["web"],
      "source": "handbook",
      "snippet": "… build APIs with <mark>Fastify</mark> …",
      "terms": ["fastify"],
    },
  ],
  "facets": { "tags": { "web": 1 }, "sources": { "handbook": 1 } },
}
```

---

## Configuration

All configuration is via environment variables (or a `.env` file — auto-loaded).
See [`.env.example`](.env.example) for the full list. Common ones:

| Variable                 | Default             | Description                      |
| ------------------------ | ------------------- | -------------------------------- |
| `BEACON_PORT`            | `7700`              | HTTP port (`PORT` also honoured) |
| `BEACON_HOST`            | `0.0.0.0`           | Bind address                     |
| `BEACON_DATA_DIR`        | `data`              | Where the index file is stored   |
| `BEACON_INDEX_FILE`      | `<data>/index.json` | Explicit index path              |
| `BEACON_WEB_DIR`         | `web/dist`          | Built web UI directory           |
| `BEACON_CORS_ORIGIN`     | _(all)_             | Comma-separated allowed origins  |
| `BEACON_LOG_LEVEL`       | `info`              | `trace`…`error`, or `silent`     |
| `BEACON_CRAWL_MAX_PAGES` | `50`                | Default crawl page budget        |

---

## How it works

```
             ┌──────────────┐      ┌─────────────────────┐
  HTTP  ───► │  Fastify API │ ───► │   SearchEngine      │
  CLI   ───► │  + web UI    │      │   (MiniSearch)      │
  Crawler ─► └──────────────┘      └─────────┬───────────┘
                                             │ debounced, atomic
                                             ▼
                                    data/index.json  (snapshot)
```

The engine holds every document in memory and mirrors it into a MiniSearch
index. Mutations schedule a debounced, atomic write (`write temp → rename`) of a
versioned JSON snapshot. On startup the snapshot is read back and the index
rebuilt, which keeps the on-disk format stable across dependency upgrades.

---

## Project layout

```
src/core/     search engine, persistence, crawler, robots, config  (no HTTP)
src/server/   Fastify app, routes, entrypoint
src/cli/      `beacon` command
web/          React + Vite single-page UI
```

## Scripts

| Script                 | Purpose                                       |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | API + UI with hot reload                      |
| `npm run build`        | Compile server (`dist/`) and UI (`web/dist/`) |
| `npm start`            | Run the compiled server                       |
| `npm test`             | Run the Vitest suite                          |
| `npm run lint`         | ESLint                                        |
| `npm run typecheck`    | `tsc --noEmit`                                |
| `npm run cli -- <cmd>` | Run the CLI from source                       |

## License

[MIT](LICENSE)
