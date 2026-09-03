import { escapeHtml } from '../text.js';
import { hashId } from './result.js';
import type { QueryClassification, UnifiedResult } from './types.js';

function row(
  title: string,
  snippet: string,
  action: NonNullable<UnifiedResult['action']>,
): UnifiedResult {
  return {
    id: hashId(`suggestion:${action.query}:${action.deep ? 'deep' : 'x'}:${title}`),
    kind: 'suggestion',
    score: 0,
    title: escapeHtml(title),
    displayUrl: undefined,
    tags: [],
    source: 'Beacon',
    foundVia: ['Beacon'],
    snippet: escapeHtml(snippet),
    terms: [],
    origin: 'generated',
    action,
  };
}

/**
 * The guaranteed floor. Even if every provider is down and the cache is cold,
 * this returns a non-empty list of *real, actionable* search shortcuts derived
 * from the query itself — never an invented URL or a fake page.
 */
export function buildSuggestions(raw: string, cls: QueryClassification): UnifiedResult[] {
  const q = raw.trim();
  const out: UnifiedResult[] = [];
  const e = cls.entities;

  out.push(
    row(
      `Run a deep search for “${q}”`,
      'Search every configured public index, archive and specialist source. This runs more queries and takes longer.',
      { query: q, deep: true, label: 'Deep search' },
    ),
  );

  if (!/^".*"$/.test(q) && q.includes(' ')) {
    out.push(
      row(
        `Search for the exact phrase "${q}"`,
        'Match the words together, in order, instead of separately.',
        { query: `"${q}"`, label: 'Exact phrase' },
      ),
    );
  }

  if (e.rootDomain && e.rootDomain !== q) {
    out.push(
      row(
        `Explore the domain ${e.rootDomain}`,
        'Look for archived captures, Common Crawl pages, subdomains and certificate records.',
        { query: e.rootDomain, deep: true, label: 'Domain pivot' },
      ),
    );
  }
  if (e.hostname && e.pathTerms) {
    out.push(
      row(
        `Search the page topic: ${e.pathTerms}`,
        `Terms taken from the URL path on ${e.hostname}.`,
        { query: e.pathTerms, label: 'Path terms' },
      ),
    );
  }
  if (cls.type === 'email' && e.localPart) {
    out.push(
      row(
        `Search the name part “${e.localPart}”`,
        'Look for the username / handle instead of the full email address.',
        { query: e.localPart, deep: true, label: 'Username' },
      ),
    );
  }
  if (cls.type === 'username') {
    out.push(
      row(
        `Search “${cls.value.replace(/[._-]/g, ' ')}” as a name`,
        'Treat the handle as spaced-out words.',
        { query: cls.value.replace(/[._-]/g, ' '), label: 'As a name' },
      ),
    );
  }

  // De-broadening: drop the last word.
  const words = q.replace(/"/g, '').split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    const broader = words.slice(0, -1).join(' ');
    out.push(
      row(`Broaden to “${broader}”`, 'Search with fewer words for more results.', {
        query: broader,
        label: 'Broaden',
      }),
    );
  }

  return out.slice(0, 6);
}
