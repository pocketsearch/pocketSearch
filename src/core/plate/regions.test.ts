import { describe, expect, it } from 'vitest';
import { knownMemoryTagLetters, lookupMemoryTag } from './regions.js';

describe('lookupMemoryTag', () => {
  it('resolves region and former office by second letter range', () => {
    expect(lookupMemoryTag('LA')).toMatchObject({
      region: 'London',
      office: 'Wimbledon',
      country: 'England',
    });
    expect(lookupMemoryTag('AV')).toMatchObject({ region: 'Anglia', office: 'Ipswich' });
    expect(lookupMemoryTag('SK')).toMatchObject({ region: 'Scotland', office: 'Edinburgh' });
    expect(lookupMemoryTag('CW')).toMatchObject({ region: 'Cymru (Wales)', country: 'Wales' });
  });

  it('is case-insensitive', () => {
    expect(lookupMemoryTag('la')?.office).toBe('Wimbledon');
  });

  it('returns null for tags outside the DVLA table', () => {
    expect(lookupMemoryTag('ZZ')).toBeNull();
    expect(lookupMemoryTag('QT')).toBeNull();
    expect(lookupMemoryTag('I')).toBeNull();
  });

  it('does not include I, Q or Z as region letters', () => {
    const letters = knownMemoryTagLetters();
    expect(letters).not.toContain('I');
    expect(letters).not.toContain('Q');
    expect(letters).not.toContain('Z');
  });
});
