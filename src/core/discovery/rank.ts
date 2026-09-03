import { normalizeWhitespace, tokenize } from '../text.js';
import { canonicalUrl, lexicalRelevance } from './result.js';
import type { QueryClassification, ResultOrigin, UnifiedResult } from './types.js';

const RARE_ORIGINS: ReadonlySet<ResultOrigin> = new Set(['archive', 'academic', 'code']);

function titleKey(title: string): string {
  return tokenize(normalizeWhitespace(title.replace(/<[^>]+>/g, '')))
    .slice(0, 12)
    .join(' ');
}

/** Merge results that point at the same page (canonical URL) or have an
 *  identical normalized title, unioning their `foundVia` provenance. */
export function dedupe(results: UnifiedResult[]): { merged: UnifiedResult[]; removed: number } {
  const byKey = new Map<string, UnifiedResult>();
  let removed = 0;

  for (const result of results) {
    const key = result.url
      ? `u:${canonicalUrl(result.url)}`
      : result.kind === 'suggestion'
        ? `s:${result.id}`
        : `t:${result.origin}:${titleKey(result.title)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...result, foundVia: [...new Set(result.foundVia)] });
      continue;
    }
    removed += 1;
    existing.foundVia = [...new Set([...existing.foundVia, ...result.foundVia])];
    existing.score = Math.max(existing.score, result.score);
    if (!existing.snippet && result.snippet) existing.snippet = result.snippet;
    if (!existing.archived && result.archived) {
      existing.archived = true;
      existing.archivedDate = result.archivedDate;
    }
    // Prefer a live/index origin over an archive-only one for the canonical row.
    if (existing.origin === 'archive' && result.origin !== 'archive') {
      existing.origin = result.origin;
      existing.url = result.url ?? existing.url;
      existing.title = result.title;
    }
  }
  return { merged: [...byKey.values()], removed };
}

export interface RankOptions {
  query: string;
  classification: QueryClassification;
  now?: number;
}

/**
 * Score every result. Deliberately *not* a popularity ranking — material that
 * only turns up via archives / CT logs / specialist indexes gets a rarity and
 * source-diversity boost so it isn't buried under generic high-authority pages.
 */
export function rank(results: UnifiedResult[], opts: RankOptions): UnifiedResult[] {
  const terms = tokenize(opts.query);
  const exactValue = opts.classification.value.toLowerCase();
  const domainSeen = new Map<string, number>();
  const now = opts.now ?? Date.now();

  const scored = results.map((r) => {
    if (r.kind === 'suggestion') return { r, score: -1 };

    const text = `${r.title} ${r.snippet}`;
    const relevance = lexicalRelevance(text, terms);
    const titleRel = lexicalRelevance(r.title, terms);

    let score = 0;
    score += relevance * 3;
    score += titleRel * 2;
    score += r.score; // provider's own confidence
    // Local confidence — but scaled by how well the doc actually matches, so a
    // loose OR-pass hit on a common word doesn't outrank real web results.
    if (r.origin === 'index') score += 0.35 + 1.1 * Math.max(relevance, titleRel);
    if (exactValue && text.toLowerCase().includes(exactValue)) score += 1.5;
    if (r.url && r.url.toLowerCase().includes(exactValue)) score += 1.0;

    // Rarity / discoverability boost — only when it also matches reasonably well.
    if (RARE_ORIGINS.has(r.origin) && (relevance > 0.3 || titleRel > 0.3 || r.archived)) {
      score += 0.8;
    }
    if (r.foundVia.length > 1) score += 0.25 * (r.foundVia.length - 1); // corroborated

    // Freshness for dated material.
    if (r.archivedDate) {
      const age = now - Date.parse(r.archivedDate);
      if (Number.isFinite(age) && age > 0) {
        score += Math.max(0, 0.5 - age / (1000 * 60 * 60 * 24 * 365 * 6));
      }
    }

    // Source diversity: soft penalty for the 3rd+ result from one domain.
    const domain = r.source ?? 'unknown';
    const n = domainSeen.get(domain) ?? 0;
    domainSeen.set(domain, n + 1);
    if (n >= 2) score -= 0.4 * (n - 1);

    if (r.kind === 'related') score -= 0.5;

    return { r, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .map(({ r, score }) => ({ ...r, score: Number(Math.max(0, score).toFixed(4)) }));
}

/**
 * Results are "insufficient" — keep widening the search — when there are few of
 * them, they're all from one source, or none is a strong match.
 */
export function insufficient(results: UnifiedResult[], query: string): boolean {
  const useful = results.filter((r) => r.kind === 'exact' || r.kind === 'related');
  if (useful.length < 5) return true;

  const sources = new Set(useful.map((r) => r.foundVia[0] ?? r.source ?? '?'));
  if (sources.size < 2) return true;

  const terms = tokenize(query);
  const strong = useful.some((r) => lexicalRelevance(`${r.title} ${r.snippet}`, terms) >= 0.5);
  if (!strong && terms.length > 0) return true;

  return false;
}
