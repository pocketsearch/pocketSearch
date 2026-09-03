import type { QueryClassification } from './types.js';

/** Common acronym expansions — small, high-value set; extend as needed. */
const ACRONYMS: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  ml: 'machine learning',
  ai: 'artificial intelligence',
  db: 'database',
  k8s: 'kubernetes',
  gh: 'github',
  pr: 'pull request',
  ci: 'continuous integration',
  osint: 'open source intelligence',
};

function singularPlural(word: string): string | null {
  if (word.length < 4) return null;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('es')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return `${word}s`;
}

/** Cheap Damerau-ish single-edit correction against a small dictionary is out of
 *  scope; instead we produce punctuation/spacing/normalisation variants that
 *  frequently recover a match, plus entity-derived variants. */
export function expandQuery(raw: string, cls: QueryClassification): string[] {
  const q = raw.trim();
  const variants = new Set<string>();
  const add = (v: string | null | undefined) => {
    const t = (v ?? '').trim();
    if (t && t.toLowerCase() !== q.toLowerCase() && t.length >= 2) variants.add(t);
  };

  const unquoted = q.replace(/["']/g, '').trim();
  add(unquoted);
  add(unquoted.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim());
  add(unquoted.normalize('NFKD').replace(/[̀-ͯ]/g, ''));
  add(unquoted.toLowerCase());

  const words = unquoted.split(/\s+/).filter(Boolean);

  // Acronym expansion (whole-query and per-word).
  const lowerJoined = words.map((w) => w.toLowerCase()).join(' ');
  if (ACRONYMS[lowerJoined]) add(ACRONYMS[lowerJoined]);
  if (words.length > 1) {
    add(words.map((w) => ACRONYMS[w.toLowerCase()] ?? w).join(' '));
  }

  // Singular / plural on the last significant word.
  if (words.length > 0) {
    const last = words[words.length - 1] ?? '';
    const sp = singularPlural(last);
    if (sp) add([...words.slice(0, -1), sp].join(' '));
  }

  // Alternative word order (reverse) for short multi-word queries.
  if (words.length >= 2 && words.length <= 4) add([...words].reverse().join(' '));

  // Drop a trailing 4-digit year ("… 2021").
  add(unquoted.replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim());

  // Quoted phrase (exact) for multi-word queries.
  if (words.length >= 2 && !/^".*"$/.test(q)) add(`"${unquoted}"`);

  // Entity-derived variants.
  const e = cls.entities;
  add(e.rootDomain);
  add(e.hostname);
  add(e.pathTerms);
  add(e.localPart);
  add(e.owner);
  add(e.repo);
  if (cls.type === 'username') {
    add(cls.value.replace(/[._-]/g, ' '));
    add(cls.value.replace(/[._-]/g, ''));
  }
  if (cls.type === 'doi') add(`"${cls.value}"`);

  return [...variants].slice(0, 8);
}
