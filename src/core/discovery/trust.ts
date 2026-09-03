import type { UnifiedResult } from './types.js';

/**
 * Per-source trust weight (0..1) used as one ranking signal. It reflects how
 * authoritative a source is for factual claims — standards bodies and official
 * vulnerability databases at the top, open discussion forums lower — and is
 * deliberately a *small* nudge in {@link import('./rank.js').rank}, never enough
 * to override lexical relevance.
 *
 * Ported from the `backpocketsearch` `SOURCE_TRUST` table.
 */
export const PROVIDER_TRUST: Readonly<Record<string, number>> = {
  NVD: 1.0,
  'CISA KEV': 1.0,
  'GitHub Advisories': 0.95,
  'OSV.dev': 0.95,
  Wikipedia: 0.9,
  OpenAlex: 0.9,
  Wikidata: 0.86,
  OpenStreetMap: 0.85,
  'Stack Overflow': 0.82,
  DuckDuckGo: 0.8,
  GitHub: 0.78,
  npm: 0.76,
  PyPI: 0.76,
  'Local index': 0.7,
  'Certificate Transparency': 0.6,
  'Hacker News': 0.55,
  'Wayback Machine': 0.55,
  'Common Crawl': 0.5,
};

const DEFAULT_TRUST = 0.5;

/** Best trust weight among the providers that surfaced this result. */
export function sourceTrust(result: Pick<UnifiedResult, 'foundVia'>): number {
  let best = DEFAULT_TRUST;
  for (const provider of result.foundVia) {
    const weight = PROVIDER_TRUST[provider];
    if (weight !== undefined && weight > best) best = weight;
  }
  return best;
}
