/**
 * Types for the "answer weave" layer: a synthesised, cited answer built on top
 * of local-index and live-web retrieval. Shared with the web UI through the
 * `@core` path alias (type-only import, erased at build time).
 */

/** How much a source can be trusted, roughly. */
export type TrustTier = 'official' | 'established' | 'community' | 'unverified';

/** Overall confidence in the woven answer. */
export type AnswerConfidence = 'high' | 'medium' | 'low' | 'none';

/** Which mechanism produced the prose. */
export type Synthesizer = 'llm-anthropic' | 'llm-openai' | 'extractive';

/** A single source that backs part of the answer. */
export interface AnswerSource {
  /** 1-based index used as the `[n]` citation marker. */
  id: number;
  title: string;
  url?: string;
  /** Where the source came from. */
  origin: 'index' | 'web';
  /** Hostname, when there is a URL. */
  domain?: string;
  trust: TrustTier;
  /** Human-readable reason for the trust tier, e.g. "gov.uk — official domain". */
  trustReason: string;
  /** ISO timestamp: fetch time for web sources, last-updated for index docs. */
  retrievedAt: string;
  /** True when the page was fetched fresh during this request. */
  live: boolean;
  /** The extract from this source that supports the answer. */
  quote: string;
}

/** One sentence of the answer plus the sources that support it. */
export interface AnswerClaim {
  text: string;
  /** Source ids backing this sentence; empty means unsupported. */
  sourceIds: number[];
  supported: boolean;
}

export interface AnswerResponse {
  query: string;
  /** The woven prose, with inline `[n]` citation markers. */
  answer: string;
  /** Sentence-level breakdown of {@link answer}. */
  claims: AnswerClaim[];
  sources: AnswerSource[];
  confidence: AnswerConfidence;
  confidenceReason: string;
  synthesizer: Synthesizer;
  /** Shown to the reader whenever confidence is below `high`. */
  disclaimer?: string;
  /** Non-fatal issues, e.g. "web search not configured", "2 sources unreachable". */
  warnings: string[];
  generatedAt: string;
  tookMs: number;
  /** True when this response was served from the short-lived answer cache. */
  cached: boolean;
}
