# Consolidation plan — porting the "smart" features from `backpocketsearch`

**Branch:** `feat/consolidate-smart-features` (off `search-discovery-cascade`)
**Base of record:** this repo (TypeScript Beacon Search) — best engine, plate workflow,
MCP, typed, tested. We keep its design/UI untouched.
**Source of features:** `github.com/pocketsearch/backpocketsearch` (Python/Flask) — weaker
searcher, but carries subsystems this repo lacks.

Ignored as sources: `pocketsearch/osint.kali` (just a zip), `abbieymatthews030-star/abeacon`
(unrelated FastAPI starter — and the wrong URL currently in our `package.json` `repository`
field; fix that too).

---

## What's genuinely "smart" over there

| # | Feature (bps) | Where it lives (bps) | Port target (this repo) | Value | Risk |
|---|---|---|---|---|---|
| 1 | ~12 extra no-key knowledge providers | `knowledge/__init__.py` | `src/core/discovery/providers/*` | High | Low |
| 2 | Source-trust scoring feeding rank | `SOURCE_TRUST` dict | `src/core/discovery/rank.ts` + `answer/trust.ts` | High | Low |
| 3 | Inline calculator / unit queries | `detect_calculation_query`, `perform_calculation` | `src/core/answer/` pre-step | Med | Low |
| 4 | Contradiction / consensus / bias detection across sources | `detect_contradictions`, `calculate_consensus`, `detect_bias` | `src/core/answer/` post-step | Med | Med |
| 5 | Query classifier + comparison-query handling | `_classify`, `_is_comparison_query`, `_extract_comparison_entities` | `src/core/discovery/classify.ts` (extend) | Med | Low |
| 6 | Entity extraction (domain / IP / repo / tech) + entity graph | `knowledge/entities.py`, `graph.py` | `src/core/knowledge/entities.ts` + store | Med | Med |
| 7 | Interest learning w/ time-decay | `knowledge/learning.py`, `storage.py` | `src/core/knowledge/interests.ts` (SQLite or JSON) | Med | Med |
| 8 | Personalised re-ranking from learned prefs | `knowledge/ranking.py`, `preferences.py` | hook into `discovery/rank.ts` | Med | Med |
| 9 | Learned query rewriting / related suggestions | `knowledge/rewriter.py` | extend `discovery/expand.ts` + `suggestions.ts` | Med | Low |
| 10 | Recommendations from history | `knowledge/recommendations.py` | `src/core/knowledge/recommend.ts` + `/api/recommendations` | Low–Med | Med |
| 11 | Auto-tagging saved docs / auto-collections | `knowledge/tagger.py`, `collections.py` | `src/core/knowledge/tagger.ts` | Low–Med | Low |
| 12 | "How-to" answer-card / difficulty adaptation | `knowledge/howto.py`, `adapt_difficulty` | `src/core/answer/` variant | Low | Med |
| 13 | Passive recon (WHOIS/DNS/TLS/headers/tech-fingerprint/sitemap) | `recon.py` | `src/core/recon/` + MCP tool + CLI verb | High (fits offensive-sec use) | Med |
| 14 | IP geolocation | `ipstack.py` | `src/core/recon/ipgeo.ts` (ipwho.is, no key) | Med | Low |

Explicitly **not** porting: Flask templates, `static/` design system, systemd/Caddy/SSL
deploy infra, analytics dashboard, Groq `assistant.py` (our answer-weave already covers
grounded Q&A; a chat tab would be UI work the user excluded).

---

## Decisions taken (2026-09-03)

- **Order:** recon toolset first, then providers, then answer intelligence.
- **Phase 3 (learning layer) is dropped** — no personalisation store, no new DB.
- **Goal framing:** "Google with more capabilities" — every kind of query a user
  would type, recon included, answered from one box.
- Recon scope: domains + IPs + URLs (passive only). People/entity routing deferred.

## Phased delivery

### Phase A — recon toolset  ✅ *in progress*
- `src/core/recon/`: target parsing, DNS-over-HTTPS (A/AAAA/MX/NS/TXT/CNAME/SOA +
  SPF/DMARC), RDAP registration data (+ system `whois` if present), TLS-cert
  summary via `node:tls`, HTTP security-header grade, tech fingerprint,
  robots/sitemap, crt.sh subdomains, IP geolocation (`ipwho.is`, no key).
- Each check runs in parallel with its own timeout + error isolation; private /
  loopback targets refused unless `BEACON_RECON_ALLOW_PRIVATE=1`.
- Surfaced like the plate checker: `GET /api/recon?target=`, MCP tools
  `recon_domain` / `recon_ip`, CLI `beacon recon <target>`, and a Recon tab in
  the web UI (functional parity only — no design-system import).
- Bare-domain / bare-IP search queries attach a recon summary result.

### Phase 1 — providers + trust (self-contained, no schema changes)  ✅ done
- Added providers: **Wikidata, DuckDuckGo Instant Answer, Stack Overflow,
  OpenAlex, GitHub repos, npm, PyPI, OSV.dev, GitHub Advisories, CISA KEV, NVD,
  Nominatim/OSM.** (GitHub *code* search dropped — needs a token.) Each
  `configured=true`, no key, own circuit breaker.
- `discovery/trust.ts` — `sourceTrust()` from a `PROVIDER_TRUST` table; fed into
  `rank.ts` as a small ±0.35 nudge, plus a bound on the raw provider-confidence
  term so an auto-indexed page can't bury authoritative sources.
- Registered in `providers/index.ts`; health on `/api/health` automatic.
- Orchestrator `runStage` task cap made per-stage so stage 1 fans out to the
  full provider roster.
- Tests: `trust.test.ts`, `providers/new-providers.test.ts`, 2 new `rank.test.ts`.

### Phase 2 — answer intelligence (no schema changes)
- Calculator pre-step (feature 3): deterministic, before retrieval; returns an answer card.
- Cross-source consensus / contradiction / bias annotations (feature 4) attached to
  `AnswerResponse`; UI already renders answer metadata blocks — additive fields only.
- Comparison-query detection (feature 5) → routes to entity-pivot expansion.

### Phase 3 — knowledge/learning store (adds persistence)
- New `src/core/knowledge/` module with its own store. Decision needed: **reuse the
  existing JSON `store.ts` pattern** (keeps "no database" promise) **or add `better-sqlite3`**
  (matches bps, better for interest decay / queries). Recommend JSON first.
- Entities + entity graph (6), interest learning w/ decay (7), preference-based
  re-ranking (8), learned rewrite/suggestions (9).
- All strictly opt-in and privacy-local; documented in `docs/`. Gated by a config flag
  (`BEACON_LEARNING=1`) so default behaviour is unchanged.

### Phase 4 — recon toolset (fits "number-plate tools etc workflow")
- `src/core/recon/`: WHOIS (system `whois` if present, else RDAP), DNS (A/AAAA/MX/NS/TXT
  via DoH), TLS cert summary, security-header audit, tech fingerprint, robots/sitemap.
- IP geolocation via `ipwho.is` (no key).
- Exposed three ways, parallel to the plate checker:
  - REST: `GET /api/recon?target=`
  - MCP tool: `recon_domain`, `recon_ip`
  - CLI: `beacon recon <target>`
- Passive only — mirror `recon.py`'s stated boundary (no port scan, no probing). Runs
  through the existing SSRF `net-guard`.

### Phase 5 — recommendations / auto-tagging / collections (10, 11)
- Depends on Phase 3 store. `/api/recommendations`, auto-tags on `POST /api/documents`,
  `/api/collections`.

### Cleanup
- Fix `package.json` `repository.url` → `github.com/pocketsearch/pocketSearch`.
- CHANGELOG entries per phase.

---

