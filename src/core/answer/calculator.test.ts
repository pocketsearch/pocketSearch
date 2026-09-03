import { describe, expect, it } from 'vitest';
import { formatCalculation, tryCalculate } from './calculator.js';

describe('tryCalculate — arithmetic', () => {
  const cases: Array<[string, number]> = [
    ['2 + 2', 4],
    ['what is 12 * 12', 144],
    ['(5 - 1) / 2', 2],
    ['2 ^ 10', 1024],
    ['10 % 3', 1],
    ['sqrt(144)', 12],
    ['3 + 4 * 2', 11],
    ['-5 + 3', -2],
    ['2 * pi', 2 * Math.PI],
    ['calculate 100 / 8', 12.5],
    ['1e3 + 24', 1024],
  ];
  it.each(cases)('%s = %d', (input, expected) => {
    const r = tryCalculate(input);
    expect(r?.kind).toBe('arithmetic');
    expect(r?.value).toBeCloseTo(expected, 6);
  });

  it('rejects non-math text', () => {
    expect(tryCalculate('what is the capital of France')).toBeNull();
    expect(tryCalculate('42')).toBeNull(); // a bare number isn't a calculation
    expect(tryCalculate('hello world')).toBeNull();
    expect(tryCalculate('2 +')).toBeNull();
    expect(tryCalculate('rm -rf /')).toBeNull();
  });

  it('formats large integers with separators', () => {
    expect(tryCalculate('1000 * 1000')?.formatted).toBe('1,000,000');
  });
});

describe('tryCalculate — percentages', () => {
  it('X% of Y', () => {
    expect(tryCalculate('15% of 200')).toMatchObject({ kind: 'percentage', value: 30 });
    expect(tryCalculate("what's 20 percent of 50")).toMatchObject({ value: 10 });
  });

  it('X as a percentage of Y', () => {
    const r = tryCalculate('30 as a percentage of 120');
    expect(r?.value).toBeCloseTo(25);
    expect(r?.formatted).toBe('25%');
  });

  it('increase / decrease by a percentage', () => {
    expect(tryCalculate('200 increased by 10%')?.value).toBeCloseTo(220);
    expect(tryCalculate('200 decreased by 10%')?.value).toBeCloseTo(180);
  });
});

describe('tryCalculate — unit conversions', () => {
  it('length', () => {
    const r = tryCalculate('10 km to miles');
    expect(r?.kind).toBe('unit-conversion');
    expect(r?.value).toBeCloseTo(6.213712, 4);
  });

  it('temperature', () => {
    expect(tryCalculate('100 c to f')?.value).toBeCloseTo(212);
    expect(tryCalculate('32 f in c')?.value).toBeCloseTo(0);
    expect(tryCalculate('300 k to c')?.value).toBeCloseTo(26.85, 2);
  });

  it('mass and time and data', () => {
    expect(tryCalculate('5 kg in lb')?.value).toBeCloseTo(11.0231, 3);
    expect(tryCalculate('2 hours in minutes')?.value).toBeCloseTo(120);
    expect(tryCalculate('1 gb to mb')?.value).toBeCloseTo(1000);
  });

  it('rejects a cross-dimension conversion', () => {
    expect(tryCalculate('10 km to kg')).toBeNull();
  });
});

describe('formatCalculation', () => {
  it('renders a one-liner', () => {
    expect(formatCalculation(tryCalculate('2 + 2')!)).toBe('2 + 2 = 4');
    expect(formatCalculation(tryCalculate('10 km to miles')!)).toMatch(/^10 km in miles = 6\.21/);
  });
});
