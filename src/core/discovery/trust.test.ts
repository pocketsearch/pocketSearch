import { describe, expect, it } from 'vitest';
import { PROVIDER_TRUST, sourceTrust } from './trust.js';

describe('sourceTrust', () => {
  it('returns the highest weight among the surfacing providers', () => {
    expect(sourceTrust({ foundVia: ['Hacker News', 'NVD'] })).toBe(PROVIDER_TRUST.NVD);
    expect(sourceTrust({ foundVia: ['Wikipedia'] })).toBe(PROVIDER_TRUST.Wikipedia);
  });

  it('falls back to a neutral 0.5 for unknown providers', () => {
    expect(sourceTrust({ foundVia: ['Some Random Source'] })).toBe(0.5);
    expect(sourceTrust({ foundVia: [] })).toBe(0.5);
  });

  it('rates official vulnerability databases above discussion forums', () => {
    expect(PROVIDER_TRUST['CISA KEV']).toBeGreaterThan(PROVIDER_TRUST['Hacker News']!);
    expect(PROVIDER_TRUST['NVD']).toBeGreaterThan(PROVIDER_TRUST['Common Crawl']!);
  });
});
