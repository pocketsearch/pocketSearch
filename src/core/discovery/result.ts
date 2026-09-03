import { createHash } from 'node:crypto';
import { escapeHtml, highlight, normalizeWhitespace, tokenize } from '../text.js';
import type { ResultKind, ResultOrigin, UnifiedResult } from './types.js';

const TRACKING_PARAMS = /^(utm_|ref_?$|fbclid$|gclid$|mc_eid$|mc_cid$|igshid$|yclid$|_hsenc$|_hsmi$)/i;

/** Canonicalise a URL for dedup: lower-case host, drop `www.`, tracking params,
 *  fragments and trailing slashes, and unwrap web.archive.org wrappers. */
export function canonicalUrl(raw: string): string {
  let url = raw.trim();
  const archive = /^https?:\/\/web\.archive\.org\/web\/\d+(?:id_|if_|im_)?\/(https?:\/\/.+)$/i.exec(
    url,
  );
  if (archive?.[1]) url = archive[1];
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const search = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${path}${search ? `?${search}` : ''}`;
  } catch {
    return url.replace(/#.*$/, '').replace(/\/+$/, '');
  }
}

export function domainOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** `example.com › docs › page` */
export function breadcrumb(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return [u.hostname.replace(/^www\./, ''), ...parts].join(' › ');
  } catch {
    return url;
  }
}

export function hashId(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

export interface MakeResultInput {
  title: string;
  url?: string;
  snippet?: string;
  provider: string;
  origin: ResultOrigin;
  kind?: ResultKind;
  tags?: string[];
  source?: string;
  score?: number;
  archived?: boolean;
  archivedDate?: string;
  terms: string[];
  action?: UnifiedResult['action'];
  /** Skip highlighting (already-highlighted local-index hits). */
  preHighlighted?: boolean;
}

/** Build a `UnifiedResult`, HTML-escaping + highlighting title/snippet unless the
 *  caller says the strings are already highlighted. */
export function makeResult(input: MakeResultInput): UnifiedResult {
  const title = normalizeWhitespace(input.title || input.url || 'Untitled').slice(0, 300);
  const snippet = normalizeWhitespace(input.snippet ?? '').slice(0, 500);
  const id = input.url ? hashId(canonicalUrl(input.url)) : hashId(`${input.provider}:${title}`);
  return {
    id,
    kind: input.kind ?? 'exact',
    score: input.score ?? 0,
    title: input.preHighlighted ? input.title : highlight(title, input.terms),
    url: input.url,
    displayUrl: breadcrumb(input.url),
    tags: input.tags ?? [],
    source: input.source ?? domainOf(input.url) ?? input.provider,
    foundVia: [input.provider],
    snippet: input.preHighlighted ? input.snippet ?? '' : highlight(snippet, input.terms),
    terms: input.terms,
    origin: input.origin,
    archived: input.archived,
    archivedDate: input.archivedDate,
    action: input.action,
  };
}

/** Rough lexical relevance of a candidate to the query terms (0..1). */
export function lexicalRelevance(text: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0.2;
  const haystack = new Set(tokenize(text));
  let hits = 0;
  for (const term of queryTerms) if (haystack.has(term)) hits += 1;
  return hits / queryTerms.length;
}

export { escapeHtml };
