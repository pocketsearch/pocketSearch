/**
 * Cross-source analysis over the sources backing a woven answer: how much they
 * agree, where they appear to contradict each other, and what slant each one
 * carries. Heuristic and deterministic — ported from `backpocketsearch`'s
 * `calculate_consensus` / `detect_contradictions` / `detect_bias`. Attached to
 * {@link import('./types.js').AnswerResponse} as `analysis`, purely additive.
 */

import type { AnswerSource } from './types.js';

export type BiasSignal = 'commercial' | 'opinion' | 'scientific' | 'political' | 'neutral';

export interface SourceBias {
  id: number;
  domain?: string;
  signals: BiasSignal[];
}

export interface SourceContradiction {
  a: { id: number; title: string; domain?: string };
  b: { id: number; title: string; domain?: string };
  /** Token-overlap similarity of the two extracts, 0..1. */
  overlap: number;
  note: string;
}

export interface CrossSourceAnalysis {
  consensus: {
    /** Mean pairwise similarity of the source extracts, as a percentage. */
    agreementPct: number;
    distinctSources: number;
    note: string;
  };
  contradictions: SourceContradiction[];
  bias: SourceBias[];
}

const CONTRAST_MARKERS = [
  'not', 'no longer', 'never', "don't", "doesn't", "isn't", "aren't", "can't",
  'cannot', 'unlike', 'however', 'but ', 'although', 'contrary', 'whereas',
  'incorrect', 'myth', 'debunk', 'false',
];

const COMMERCIAL = ['buy', 'price', 'discount', 'deal', 'sale', 'coupon', 'sponsored', 'affiliate', 'best deal', 'shop', 'order now', 'add to cart'];
const OPINION = ['i think', 'i believe', 'in my opinion', 'we feel', 'arguably', 'obviously', 'clearly', 'undoubtedly', 'should', 'must ', 'the best way'];
const SCIENTIFIC = ['study', 'studies', 'research', 'published', 'peer-reviewed', 'journal', 'clinical', 'trial', 'experiment', 'dataset', 'et al', 'doi'];
const POLITICAL = ['liberal', 'conservative', 'progressive', 'left-wing', 'right-wing', 'partisan', 'election', 'the party', 'lawmakers'];

const SCIENTIFIC_DOMAINS = /(\.gov$|\.edu$|nih\.gov|who\.int|nature\.com|science\.org|arxiv\.org|nvd\.nist\.gov|cisa\.gov|osv\.dev|wikipedia\.org|openalex\.org)/i;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, ' ')
      .match(/[a-z0-9']+/g)
      ?.filter((w) => w.length > 2) ?? [],
  );
}

/** Overlap coefficient: |A ∩ B| / min(|A|, |B|). */
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function numbersIn(text: string): number[] {
  return (text.match(/\b\d+(?:\.\d+)?\b/g) ?? []).map(Number).filter((n) => n > 0 && n < 1e12);
}

function biasFor(source: AnswerSource): SourceBias {
  const text = `${source.title} ${source.quote}`.toLowerCase();
  const signals = new Set<BiasSignal>();
  if (COMMERCIAL.some((s) => text.includes(s))) signals.add('commercial');
  if (OPINION.some((s) => text.includes(s))) signals.add('opinion');
  if (SCIENTIFIC.some((s) => text.includes(s)) || (source.domain && SCIENTIFIC_DOMAINS.test(source.domain))) {
    signals.add('scientific');
  }
  if (POLITICAL.some((s) => text.includes(s))) signals.add('political');
  if (signals.size === 0) signals.add('neutral');
  return { id: source.id, domain: source.domain, signals: [...signals] };
}

/**
 * Analyse the sources behind an answer. Returns `null` when there are fewer than
 * two, since none of the three signals is meaningful for a single source.
 */
export function analyzeSources(sources: AnswerSource[]): CrossSourceAnalysis | null {
  if (sources.length < 2) return null;

  const texts = sources.map((s) => ({
    source: s,
    tokens: tokenize(`${s.title} ${s.quote}`),
    raw: `${s.title}. ${s.quote}`,
  }));

  // --- consensus -----------------------------------------------------
  const sims: number[] = [];
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      sims.push(similarity(texts[i]!.tokens, texts[j]!.tokens));
    }
  }
  const avg = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;
  const agreementPct = Math.round(avg * 1000) / 10;
  const distinctSources = new Set(sources.map((s) => s.domain ?? s.origin)).size;
  const consensusNote =
    agreementPct >= 55
      ? 'sources broadly agree'
      : agreementPct >= 30
        ? 'sources partially overlap'
        : 'sources cover the topic from different angles';

  // --- contradictions ----------------------------------------------
  const contradictions: SourceContradiction[] = [];
  for (let i = 0; i < texts.length && contradictions.length < 3; i += 1) {
    for (let j = i + 1; j < texts.length && contradictions.length < 3; j += 1) {
      const a = texts[i]!;
      const b = texts[j]!;
      const sim = similarity(a.tokens, b.tokens);
      if (sim < 0.28) continue; // unrelated

      const aLow = a.raw.toLowerCase();
      const bLow = b.raw.toLowerCase();
      const aNeg = CONTRAST_MARKERS.some((w) => aLow.includes(w));
      const bNeg = CONTRAST_MARKERS.some((w) => bLow.includes(w));

      const aNums = numbersIn(a.raw);
      const bNums = numbersIn(b.raw);
      const numberClash =
        aNums.length > 0 &&
        bNums.length > 0 &&
        !aNums.some((n) => bNums.some((m) => Math.abs(n - m) / Math.max(n, m) < 0.05));

      // A figure clash is meaningful even between near-identical sentences (same
      // claim, different number). A polarity clash needs genuinely distinct text
      // (too-similar => probably the same passage, not a real disagreement).
      if (!numberClash && (sim > 0.85 || aNeg === bNeg)) continue;

      contradictions.push({
        a: { id: a.source.id, title: a.source.title, domain: a.source.domain },
        b: { id: b.source.id, title: b.source.title, domain: b.source.domain },
        overlap: Math.round(sim * 100) / 100,
        note: numberClash
          ? 'these sources cite different figures for the same thing'
          : 'one source qualifies or negates what the other states',
      });
    }
  }

  return {
    consensus: { agreementPct, distinctSources, note: consensusNote },
    contradictions,
    bias: sources.map(biasFor),
  };
}
