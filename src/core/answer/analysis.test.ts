import { describe, expect, it } from 'vitest';
import { analyzeSources } from './analysis.js';
import type { AnswerSource } from './types.js';

const src = (over: Partial<AnswerSource> & { id: number }): AnswerSource => ({
  title: '',
  origin: 'web',
  trust: 'community',
  trustReason: '',
  retrievedAt: new Date().toISOString(),
  live: true,
  quote: '',
  ...over,
});

describe('analyzeSources', () => {
  it('returns null for fewer than two sources', () => {
    expect(analyzeSources([])).toBeNull();
    expect(analyzeSources([src({ id: 1, quote: 'anything' })])).toBeNull();
  });

  it('reports high agreement when the extracts overlap heavily', () => {
    const a = analyzeSources([
      src({ id: 1, domain: 'a.com', title: 'Fastify performance', quote: 'Fastify is a fast low overhead web framework for Node.js' }),
      src({ id: 2, domain: 'b.com', title: 'Fastify overview', quote: 'Fastify is a fast, low overhead web framework for Node js' }),
    ]);
    expect(a?.consensus.agreementPct).toBeGreaterThan(50);
    expect(a?.consensus.distinctSources).toBe(2);
  });

  it('flags a contradiction when one source negates a similar claim', () => {
    const a = analyzeSources([
      src({ id: 1, domain: 'a.com', title: 'Coffee and health', quote: 'Studies show coffee consumption reduces the risk of type 2 diabetes' }),
      src({ id: 2, domain: 'b.com', title: 'Coffee and health', quote: 'Coffee consumption does not reduce the risk of type 2 diabetes, however the evidence is weak' }),
    ]);
    expect(a?.contradictions.length).toBeGreaterThanOrEqual(1);
    expect(a?.contradictions[0]?.a.id).toBe(1);
  });

  it('flags a numeric clash', () => {
    const a = analyzeSources([
      src({ id: 1, title: 'Active user count', quote: 'The platform reports around 5 million monthly active users worldwide today' }),
      src({ id: 2, title: 'Active user count', quote: 'The platform reports around 40 million monthly active users worldwide today' }),
    ]);
    expect(a?.contradictions.some((c) => c.note.includes('figures'))).toBe(true);
  });

  it('tags commercial and scientific bias signals', () => {
    const a = analyzeSources([
      src({ id: 1, domain: 'shop.example', title: 'Best laptop deal', quote: 'Buy now at the best price with a discount coupon' }),
      src({ id: 2, domain: 'nature.com', title: 'A study', quote: 'This peer-reviewed research published in a journal presents new data' }),
    ])!;
    expect(a.bias.find((b) => b.id === 1)?.signals).toContain('commercial');
    expect(a.bias.find((b) => b.id === 2)?.signals).toContain('scientific');
  });
});
