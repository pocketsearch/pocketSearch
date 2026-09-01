import { describe, expect, it } from 'vitest';
import { classifyPlate, formatPlate, normalizePlate } from './format.js';

describe('normalizePlate', () => {
  it('upper-cases and strips non-alphanumerics', () => {
    expect(normalizePlate(' ab12 cde ')).toBe('AB12CDE');
    expect(normalizePlate('a-1.a.b/c')).toBe('A1ABC');
  });
});

describe('classifyPlate', () => {
  const cases: Array<[string, string, boolean]> = [
    ['AB12CDE', 'current', true],
    ['LA51ABC', 'current', true],
    ['AB12CDZ', 'current', true], // Z allowed in the random group
    ['AI12CDE', 'current', false], // I illegal in the memory tag
    ['AB12CQE', 'current', false], // Q illegal in the random group
    ['A123BCD', 'prefix', true],
    ['V856HFE', 'prefix', true],
    ['ABC123A', 'suffix', true],
    ['KZ1234', 'northern-ireland', true],
    ['FEZ1234', 'northern-ireland', true],
    ['1A', 'dateless', true],
    ['9999AB', 'dateless', true],
    ['HELLOWORLD', 'unknown', false],
    ['', 'unknown', false],
  ];

  it.each(cases)('classifies %s as %s (valid=%s)', (plate, format, valid) => {
    const result = classifyPlate(plate);
    expect(result.format).toBe(format);
    expect(result.valid).toBe(valid);
  });
});

describe('formatPlate', () => {
  it('inserts the conventional spacing', () => {
    expect(formatPlate('AB12CDE', 'current')).toBe('AB12 CDE');
    expect(formatPlate('A123BCD', 'prefix')).toBe('A123 BCD');
    expect(formatPlate('ABC123A', 'suffix')).toBe('ABC 123A');
    expect(formatPlate('KZ1234', 'northern-ireland')).toBe('KZ 1234');
  });
});
