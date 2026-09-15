# Discovery — the "never a dead end" search

Beacon's plain index search (`GET /api/search?q=…`) is unchanged: it queries the
local MiniSearch index and can legitimately return `total: 0`.

The **discovery layer** wraps that index in a cascade so the *user-facing* search
experience is never a dead end. The web UI always uses it; the API opts in with
`?fallback=1` (and `?deep=1` for a wider pass).

> **Invariant:** for every non-empty query, the response contains at least one
> renderable result — an exact hit, related material, or a real search shortcut.
> Suggestions are derived from the query itself; **no URLs or pages are invented.**

## The cascade

`src/core/discovery/orchestrator.ts` runs stages until the result set is no
longer "insufficient" (`< 5 useful results`, single-source, or no strong match —
`rank.ts#insufficient`). A **deep** search runs every stage regardless.

| Stage | What runs |
| ----- | --------- |
| 1 — exact | local index + web-search + the fast keyless providers (Wikipedia, Wikidata, DuckDuckGo, Stack Overflow, GitHub, npm, PyPI, OpenAlex, OpenStreetMap, Hacker News), on the raw & normalized query |
| 2 — expansion | the same fast providers on generated variants (`expand.ts`): unquoted, punctuation-stripped, unicode-folded, singular/plural, acronym, reordered, date-free, quoted-phrase, plus entity-derived (root domain, hostname, path terms, email local-part, …) |
| 3 — discovery | Wayback CDX, Common Crawl URL index, certificate transparency (crt.sh), and the vulnerability databases (OSV.dev, GitHub Advisories, NVD, CISA KEV) for CVE / security-flavoured queries |
| 4 — entity pivot | classification-driven queries — root domain / subdomains for a domain, path terms for a URL, handle-as-words for a username, local-part for an email |
| 5 — persist | fetch the top few new public pages through the robots + SSRF-guard stack and add them to the local index (best-effort, `BEACON_DISCOVERY_CRAWL`) |
| 6 — related & suggestions | weak exacts are demoted to *related*; real query-derived search shortcuts are always appended as the floor (`suggestions.ts`) |

## Providers (`src/core/discovery/providers/`)

Each implements `SearchProvider` — `name`, `category`, `priority`, `timeoutMs`,
`supportedQueryTypes`, `configured`, `search()`. Every call is wrapped by
`runProvider()` (`providers/base.ts`) which adds a per-provider timeout, races
the call against its deadline, isolates errors, and drives a **circuit breaker**
(`healthy → degraded → temporarily_disabled`, plus `rate_limited` /
`misconfigured`). One slow or failing provider can never break the search or
return a 500.

No-key providers, always on:

| Group | Providers |
| ----- | --------- |
| Local | Local index |
| Reference | Wikipedia, Wikidata, DuckDuckGo Instant Answer, OpenStreetMap (Nominatim) |
| Code / packages | GitHub repositories, Stack Overflow, npm, PyPI, Hacker News |
| Academic | OpenAlex |
| Archives | Wayback Machine, Common Crawl |
| Infrastructure / vulnerabilities | Certificate Transparency (crt.sh), OSV.dev, GitHub Advisories, NVD, CISA KEV |

The configured web-search provider (Brave / Tavily / SearXNG — reused from the
answer layer) joins the `general_web` group when its key/URL is set.

Some providers are query-aware: OpenStreetMap only runs for place-like queries,
PyPI only resolves exact package names, and the four vulnerability databases only
run for a CVE / GHSA id or an explicitly security-flavoured query.

Adding one: implement `SearchProvider`, register it in `providers/index.ts`.
GitLab, Crossref, GDELT, RDAP, sitemap and RSS adapters slot in the same way.

## Ranking (`rank.ts`)

Not a popularity ranking. Score =
`relevance + title match + bounded provider confidence + entity match + rarity + corroboration + source-trust nudge + freshness + scaled local-confidence − duplicate/diversity penalty`.
The provider-confidence term is capped so a raw upstream relevance value (e.g.
MiniSearch's unnormalised score on an auto-indexed page) can't dominate, and a
small **source-trust** weight (`trust.ts`, ported from `backpocketsearch`) lets
an authoritative source — a standards body, an official vulnerability database —
edge ahead of a forum post of equal relevance.
Archive-only and specialist hits that match strongly get a **rarity boost** so
they aren't buried under generic high-authority pages.

Dedup canonicalises URLs (drops `utm_*` / `fbclid` / `gclid` / fragments /
`www.` / trailing slashes, unwraps `web.archive.org` snapshots) and merges
same-URL / same-title rows, unioning their `foundVia` provenance.

## Response shape (superset of `SearchResponse`)

```jsonc
{
  "query": "…", "normalizedQuery": "…", "queryType": "domain",
  "hits": [ /* UnifiedResult[] — this page */ ],
  "total": 83, "limit": 10, "offset": 0, "tookMs": 1840,
  "exactCount": 70, "relatedCount": 12, "suggestionCount": 1,
  "fallbackStage": 4, "stagesRun": ["exact","expansion","discovery","pivot"],
  "sources": [ { "name": "Wayback Machine", "status": "healthy", "ms": 1386, "count": 20 } ],
  "sourcesCompleted": 6, "sourcesFailed": 1, "searching": false,
  "cached": false, "cachedAt": null, "deep": true,
  "facets": { "tags": {}, "sources": {} }
}
```

`UnifiedResult`: `id, kind ('exact'|'related'|'suggestion'), score, title, url,
displayUrl, source, foundVia[], snippet, terms[], origin, archived,
archivedDate, action` (for suggestions).

## Caching & progressive results

Results are cached by normalized query + deep flag (fresh 5 min, hard 24 h). If
every provider fails, a stale entry is served and labelled `cached`. After a thin
normal search the orchestrator pre-computes the deep search in the background;
the response carries `searching: true` and the UI polls once and swaps in the
richer set without losing scroll position.

## Config

`BEACON_DISCOVERY_ENABLED`, `BEACON_DISCOVERY_BUDGET_MS`,
`BEACON_DISCOVERY_DEEP_BUDGET_MS`, `BEACON_DISCOVERY_CRAWL` — see
[`.env.example`](../.env.example).
