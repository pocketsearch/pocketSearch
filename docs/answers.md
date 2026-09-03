# Answer weave

Beacon can return a short written **answer** for a query, not just a list of
hits. The answer is only ever assembled from sources it actually retrieved, and
it is explicit about where every statement comes from and how far to trust it.

- Web UI: the Search tab auto-runs an answer for question-like queries
  (`?` present, starts with who/what/how/…, or ≥ 4 words). Other queries get a
  "weave an answer" button. Disable the auto behaviour with
  `BEACON_ANSWER_AUTO=false`.
- API: `GET /api/answer?q=<query>&fresh=<bool>`. `fresh=true` bypasses the
  5-minute in-process answer cache.
- Off switch: `BEACON_ANSWER_ENABLED=false` removes the route and hides the card.

## Pipeline

0. **Calculator** (`src/core/answer/calculator.ts`) — before any retrieval, the
   query is checked for a self-contained calculation: arithmetic (`2^10`,
   `sqrt(144)`, `3 + 4 * 2`, constants `pi`/`e`), a percentage (`15% of 200`,
   `30 as a percentage of 120`, `200 increased by 10%`), or a unit conversion
   (`10 km to miles`, `100 c to f`, `5 kg in lb`, `2 hours in minutes`,
   `1 gb to mb`). Arithmetic is evaluated by a small recursive-descent parser —
   never `eval`. On a hit the answer is returned immediately with
   `synthesizer: "calculator"`, `confidence: "high"`, a `calculation` object,
   and no sources.
1. **Retrieve** (`src/core/answer/retrieval.ts`)
   - Local index: an OR-combined search, top _n_ documents.
   - Live web: if `BEACON_ANSWER_WEB_SEARCH` is `brave` / `tavily` / `searxng`
     and its credential is set, the query is run against that provider and the
     top results are fetched — each URL is checked against the SSRF guard
     (`hostIsPrivate`) and `robots.txt`, then fetched with a timeout and reduced
     to readable text. Unreachable / blocked URLs become `warnings`.
   - Sources are de-duplicated by URL and capped at `BEACON_ANSWER_MAX_SOURCES`.
2. **Ground** (`src/core/answer/extract.ts`) — each source is split into
   sentences; the sentences that best cover the query terms (weighted by source
   trust) are selected and kept tied to their source id. Index sources that
   contribute no relevant sentence are dropped.
3. **Weave** (`src/core/answer/providers/llm.ts`) — the grounded sentences and a
   short excerpt per source are handed to an LLM with a strict instruction to
   use only those extracts and to cite every sentence. Providers are tried in
   order: Anthropic (`ANTHROPIC_API_KEY`), then any OpenAI-compatible endpoint
   (`OPENAI_API_KEY` + `BEACON_ANSWER_OPENAI_MODEL`). If none is configured, or
   all fail, the deterministic weave from step 2 is used and `synthesizer` is
   `extractive`.
4. **Verify** (`src/core/answer/answer-service.ts`) — the woven prose is split
   back into sentences; `[n]` markers pointing at a non-existent source are
   dropped, and each sentence is checked for token overlap against the text of
   the sources it cites. Sentences that fail are marked `supported: false`.

## Trust tiers

Assigned from the source URL (`src/core/answer/trust.ts`):

| Tier          | What it means                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `official`    | `.gov` / `.gov.uk` / `.mil` / `.int` / `.edu` / `.ac.uk` / `nhs.uk` / EU / UN / WHO / …, or a domain listed in `BEACON_ANSWER_TRUSTED_DOMAINS` |
| `established` | curated encyclopedias, wire services, standards bodies, peer-reviewed publishers (Wikipedia, Reuters, Nature, W3C, IETF, …)                    |
| `community`   | any other page that was fetched successfully or is in the index with a URL                                                                     |
| `unverified`  | no URL, the page could not be fetched, or an LLM-only statement                                                                                |

## Confidence

| Value    | Condition                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------- |
| `high`   | ≥ 2 sources incl. an `official`/`established` one, at least one fetched live, every statement supported |
| `medium` | at least one `official`/`established` source and ≤ half the statements unsupported                      |
| `low`    | only `community`/`unverified` sources, or > half the statements unsupported                             |
| `none`   | no statement could be tied to a source                                                                  |

A `disclaimer` is attached for anything below `high`. When confidence is `none`
the answer is either an honest "the sources don't answer this" line or, if an
LLM ran, a single paragraph explicitly prefixed **"Unverified — general
knowledge, not backed by a retrieved source"**. The endpoint always returns a
non-empty answer.

## Cross-source analysis

When an answer has ≥ 2 sources, the response also carries an `analysis` object
(`src/core/answer/analysis.ts`, heuristic and deterministic):

- **consensus** — mean pairwise token-overlap of the source extracts, as an
  agreement percentage, plus the number of distinct domains.
- **contradictions** — up to 3 pairs of sources that cover the same ground but
  disagree: one negates/qualifies the other, or they cite materially different
  figures for the same thing. Each names the two source ids.
- **bias** — per-source slant tags (`commercial`, `opinion`, `scientific`,
  `political`, or `neutral`), from language cues plus the source domain.

This is a reading aid, not a verdict — it never changes the answer or its
confidence.
