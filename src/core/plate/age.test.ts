import { describe, expect, it } from 'vitest';
import { decodeCurrentAge, decodePrefixAge, decodeSuffixAge } from './age.js';

const REF = new Date('2026-09-01T00:00:00Z');

describe('decodeCurrentAge', () => {
  it('decodes a spring identifier', () => {
    const age = decodeCurrentAge('12', REF);
    expect(age).not.toBeNull();
    expect(age?.registeredFrom).toBe('2012-03-01');
    expect(age?.registeredTo).toBe('2012-08-31');
    expect(age?.approxYear).toBe(2012);
    expect(age?.description).toContain('March');
  });

  it('decodes an autumn identifier (YY + 50)', () => {
    const age = decodeCurrentAge('62', REF);
    expect(age?.registeredFrom).toBe('2012-09-01');
    expect(age?.registeredTo).toBe('2013-02-28');
    expect(age?.approxYear).toBe(2012);
  });

  it('decodes the first ever identifier "51"', () => {
    expect(decodeCurrentAge('51', REF)?.registeredFrom).toBe('2001-09-01');
  });

  it('rejects identifiers that have not been issued yet', () => {
    expect(decodeCurrentAge('77', REF)).toBeNull(); // Sept 2027
  });

  it('rejects structurally impossible identifiers', () => {
    expect(decodeCurrentAge('50', REF)).toBeNull();
    expect(decodeCurrentAge('00', REF)).toBeNull();
    expect(decodeCurrentAge('1', REF)).toBeNull();
  });
});

describe('decodePrefixAge / decodeSuffixAge', () => {
  it('decodes a prefix year letter', () => {
    const age = decodePrefixAge('A', REF);
    expect(age?.registeredFrom).toBe('1983-08-01');
    expect(age?.registeredTo).toBe('1984-07-31');
  });

  it('decodes a suffix year letter', () => {
    expect(decodeSuffixAge('A', REF)?.approxYear).toBe(1963);
    expect(decodeSuffixAge('N', REF)?.registeredFrom).toBe('1974-08-01');
  });

  it('rejects illegal year letters', () => {
    expect(decodePrefixAge('I', REF)).toBeNull();
    expect(decodeSuffixAge('Z', REF)).toBeNull();
  });
});
