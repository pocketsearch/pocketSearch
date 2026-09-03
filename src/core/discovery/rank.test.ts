import { describe, expect, it } from 'vitest';
import { classifyQuery } from './classify.js';
import { dedupe, insufficient, rank } from './rank.js';
import { canonicalUrl, makeResult } from './result.js';
import type { UnifiedResult } from './types.js';

const mk = (over: Partial<Parameters<typeof makeResult>[0]> & { title: string }): UnifiedResult =>
  makeResult({ provider: 'x', origin: 'web', terms: [], ...over });

describe('canonicalUrl', () => {
  it('strips tracking params, fragments, www and trailing slashes', () => {
    expect(canonicalUrl('https://www.Example.com/a/?utm_source=x&id=7#frag')).toBe(
      'https://example.com/a?id=7',
    );
  });
  it('unwraps a Wayback snapshot to the original URL', () => {
    expect(canonicalUrl('https://web.archive.org/web/20200101000000/https://example.com/p')).toBe(
      'https://example.com/p',
    );
  });
});

describe('dedupe', () => {
  it('merges same-URL results and unions their provenance', () => {
    const { merged, removed } = dedupe([
      mk({ title: 'A', url: 'https://e.com/p', provider: 'One' }),
      mk({ title: 'A', url: 'https://www.e.com/p/', provider: 'Two' }),
      mk({ title: 'B', url: 'https://e.com/other', provider: 'One' }),
    ]);
    expect(merged).toHaveLength(2);
    expect(removed).toBe(1);
    const p = merged.find((m) => m.url?.includes('/p'));
    expect(p?.foundVia.sort()).toEqual(['One', 'Two']);
  });
});

describe('rank', () => {
  it('gives archive-only strong matches a rarity boost over generic pages', () => {
    const q = 'obscure zorblax protocol';
    const generic = mk({
      title: 'Homepage',
      url: 'https://big.example/',
      snippet: 'unrelated marketing copy',
      origin: 'web',
      score: 0.5,
    });
    const rare = mk({
      title: 'The obscure zorblax protocol specification',
      url: 'https://web.archive.org/web/2016/http://tiny.example/zorblax',
      snippet: 'obscure zorblax protocol internals',
      origin: 'archive',
      archived: true,
      archivedDate: '2016-05-01',
      score: 0.35,
    });
    const [top] = rank([generic, rare], { query: q, classification: classifyQuery(q) });
    expect(top?.url).toContain('zorblax');
  });

  it('bounds a runaway provider score so it cannot bury other results', () => {
    const q = 'log4shell';
    const inflated = mk({
      title: 'log4shell notes',
      url: 'https://blog.example/log4shell',
      snippet: 'log4shell',
      origin: 'index',
      score: 500, // e.g. a raw MiniSearch value on an auto-indexed page
    });
    const authoritative = mk({
      title: 'log4shell advisory',
      url: 'https://nvd.example/log4shell',
      snippet: 'log4shell remote code execution',
      origin: 'web',
      score: 0.9,
      // pretend NVD surfaced it
    });
    authoritative.foundVia = ['NVD'];
    const ranked = rank([inflated, authoritative], { query: q, classification: classifyQuery(q) });
    // the inflated one may still lead, but not by the raw 500-point margin
    const top = ranked[0]!;
    const second = ranked[1]!;
    expect(top.score - second.score).toBeLessThan(10);
  });

  it('nudges a higher-trust source ahead of an equal-relevance forum post', () => {
    const q = 'sql injection mitigation';
    const forum = mk({
      title: 'sql injection mitigation',
      url: 'https://forum.example/thread',
      snippet: 'sql injection mitigation discussion',
      origin: 'web',
      score: 0.5,
    });
    forum.foundVia = ['Hacker News'];
    const official = mk({
      title: 'sql injection mitigation',
      url: 'https://owasp.example/sqli',
      snippet: 'sql injection mitigation discussion',
      origin: 'web',
      score: 0.5,
    });
    official.foundVia = ['NVD'];
    const [top] = rank([forum, official], { query: q, classification: classifyQuery(q) });
    expect(top?.foundVia).toEqual(['NVD']);
  });

  it('suggestions always sort last', () => {
    const ranked = rank(
      [
        { ...mk({ title: 'real', url: 'https://e.com' }), score: 0.1 },
        {
          id: 's',
          kind: 'suggestion',
          score: 0,
          title: 's',
          tags: [],
          foundVia: [],
          snippet: '',
          terms: [],
          origin: 'generated',
        },
      ],
      { query: 'x', classification: classifyQuery('x') },
    );
    expect(ranked[ranked.length - 1]?.kind).toBe('suggestion');
  });
});

describe('insufficient', () => {
  it('is true for a tiny or single-source result set', () => {
    expect(insufficient([], 'anything')).toBe(true);
    const oneSource = Array.from({ length: 8 }, (_, i) =>
      mk({ title: `r${i}`, url: `https://one.example/${i}`, provider: 'Solo' }),
    );
    expect(insufficient(oneSource, 'anything')).toBe(true);
  });

  it('is false for a healthy, diverse, on-topic set', () => {
    const results = [
      mk({ title: 'kubernetes networking guide', url: 'https://a.example/1', provider: 'A', snippet: 'kubernetes networking' }),
      mk({ title: 'kubernetes networking deep dive', url: 'https://b.example/2', provider: 'B', snippet: 'kubernetes networking' }),
      mk({ title: 'kubernetes networking', url: 'https://c.example/3', provider: 'C', snippet: 'kubernetes networking' }),
      mk({ title: 'more kubernetes networking', url: 'https://d.example/4', provider: 'D', snippet: 'kubernetes networking' }),
      mk({ title: 'kubernetes networking faq', url: 'https://e.example/5', provider: 'E', snippet: 'kubernetes networking' }),
    ];
    expect(insufficient(results, 'kubernetes networking')).toBe(false);
  });
});
