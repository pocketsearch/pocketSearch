/**
 * Detect "X vs Y" style comparison queries and pull out the two things being
 * compared, so the discovery cascade can also search for each one on its own —
 * a comparison is only as good as the material it has on both sides.
 */

const SEPARATORS = [
  /\s+vs\.?\s+/i,
  /\s+versus\s+/i,
  /\s+compared\s+(?:to|with)\s+/i,
  /\s+or\s+/i, // only used when a comparison cue is also present
];

const COMPARISON_CUES =
  /\b(vs\.?|versus|compare[ds]?|comparison|difference between|which is better|better than|pros and cons of)\b/i;

const TRAILING_NOISE =
  /\b(which is better|which one|better|difference|comparison|pros and cons|reddit|explained?)\b.*$/i;

function clean(part: string): string {
  return part
    .replace(/^\s*(?:the\s+)?difference between\s+/i, '')
    .replace(/^\s*compare[ds]?\s+/i, '')
    .replace(TRAILING_NOISE, '')
    .replace(/[?.!,]+$/g, '')
    .trim();
}

export interface ComparisonParts {
  a: string;
  b: string;
}

/** Returns the two compared terms, or `null` if the query isn't a comparison. */
export function splitComparison(query: string): ComparisonParts | null {
  const q = query.trim();
  if (!COMPARISON_CUES.test(q)) return null;

  // Forms that use "and" as the split rather than a "vs"-style separator.
  const andForm =
    /(?:difference between|compare[ds]?)\s+(.+?)\s+and\s+(.+)$/i.exec(q);
  if (andForm) {
    const a = clean(andForm[1]!);
    const b = clean(andForm[2]!);
    if (a && b && a.toLowerCase() !== b.toLowerCase()) return { a, b };
  }

  for (const sep of SEPARATORS) {
    if (sep.source === '\\s+or\\s+' && !COMPARISON_CUES.test(q.replace(sep, ' '))) {
      // "A or B" alone isn't a comparison unless another cue is present.
      continue;
    }
    const parts = q.split(sep);
    if (parts.length === 2) {
      const a = clean(parts[0]!);
      const b = clean(parts[1]!);
      if (a && b && a.toLowerCase() !== b.toLowerCase() && a.length <= 60 && b.length <= 60) {
        return { a, b };
      }
    }
  }
  return null;
}
