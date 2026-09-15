/**
 * Deterministic inline calculator — the "Google gives you the answer straight
 * away" behaviour for arithmetic, percentages and unit conversions. Runs before
 * retrieval; when it fires, the answer service returns its result verbatim with
 * `high` confidence and skips the web entirely.
 *
 * No `eval` / `Function`: arithmetic goes through a small recursive-descent
 * parser over an explicit token list.
 */

export type CalculationKind = 'arithmetic' | 'percentage' | 'unit-conversion';

export interface CalculationResult {
  kind: CalculationKind;
  /** Normalised statement of what was computed. */
  expression: string;
  value: number;
  /** Display string, e.g. `"1,024"` or `"6.214 miles"`. */
  formatted: string;
  /** Optional one-line working. */
  detail?: string;
}

// --- number formatting ---------------------------------------------------

function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const r = round(n);
  if (Number.isInteger(r) && Math.abs(r) < 1e15) return r.toLocaleString('en-US');
  if (Math.abs(r) >= 1e15 || (r !== 0 && Math.abs(r) < 1e-4)) return r.toExponential(4);
  return r
    .toLocaleString('en-US', { maximumFractionDigits: 6 })
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

// --- arithmetic parser -------------------------------------------------

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  'π': Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

type Token =
  | { t: 'num'; v: number }
  | { t: 'op'; v: string }
  | { t: 'paren'; v: '(' | ')' }
  | { t: 'ident'; v: string };

function lex(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.replace(/×/g, '*').replace(/÷/g, '/').replace(/√/g, 'sqrt');
  while (i < s.length) {
    const c = s[i]!;
    if (c === ' ' || c === '\t' || c === ',') {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) return null;
      tokens.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '(' || c === ')') {
      tokens.push({ t: 'paren', v: c });
      i += 1;
      continue;
    }
    if ('+-*/^%'.includes(c)) {
      tokens.push({ t: 'op', v: c });
      i += 1;
      continue;
    }
    if (/[a-zA-Zπ]/.test(c)) {
      const m = /^[a-zA-Zπ][a-zA-Z0-9]*/.exec(s.slice(i));
      if (!m) return null;
      tokens.push({ t: 'ident', v: m[0].toLowerCase() });
      i += m[0].length;
      continue;
    }
    return null; // unknown character
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    const value = this.expr();
    if (this.pos !== this.tokens.length) throw new Error('unexpected trailing input');
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private expr(): number {
    let left = this.term();
    for (let op = this.peek(); op?.t === 'op' && (op.v === '+' || op.v === '-'); op = this.peek()) {
      this.pos += 1;
      const right = this.term();
      left = op.v === '+' ? left + right : left - right;
    }
    return left;
  }

  private term(): number {
    let left = this.power();
    for (
      let op = this.peek();
      op?.t === 'op' && (op.v === '*' || op.v === '/' || op.v === '%');
      op = this.peek()
    ) {
      this.pos += 1;
      const right = this.power();
      left = op.v === '*' ? left * right : op.v === '/' ? left / right : left % right;
    }
    return left;
  }

  private power(): number {
    const base = this.unary();
    const op = this.peek();
    if (op?.t === 'op' && op.v === '^') {
      this.pos += 1;
      return base ** this.power(); // right-associative
    }
    return base;
  }

  private unary(): number {
    const tok = this.peek();
    if (tok?.t === 'op' && (tok.v === '-' || tok.v === '+')) {
      this.pos += 1;
      const value = this.unary();
      return tok.v === '-' ? -value : value;
    }
    return this.primary();
  }

  private primary(): number {
    const tok = this.peek();
    if (!tok) throw new Error('unexpected end of expression');
    if (tok.t === 'num') {
      this.pos += 1;
      return tok.v;
    }
    if (tok.t === 'paren' && tok.v === '(') {
      this.pos += 1;
      const value = this.expr();
      const close = this.peek();
      if (close?.t !== 'paren' || close.v !== ')') throw new Error('missing closing paren');
      this.pos += 1;
      return value;
    }
    if (tok.t === 'ident') {
      this.pos += 1;
      if (tok.v in CONSTANTS) return CONSTANTS[tok.v]!;
      const fn = FUNCTIONS[tok.v];
      if (fn) {
        const open = this.peek();
        if (open?.t !== 'paren' || open.v !== '(') throw new Error(`${tok.v} needs parentheses`);
        this.pos += 1;
        const arg = this.expr();
        const close = this.peek();
        if (close?.t !== 'paren' || close.v !== ')') throw new Error('missing closing paren');
        this.pos += 1;
        return fn(arg);
      }
      throw new Error(`unknown name "${tok.v}"`);
    }
    throw new Error('unexpected token');
  }
}

function evalArithmetic(expr: string): number | null {
  const tokens = lex(expr);
  if (!tokens || tokens.length === 0) return null;
  // Require at least one operator or function so a bare number / word isn't "math".
  if (!tokens.some((t) => t.t === 'op' || (t.t === 'ident' && t.v in FUNCTIONS))) return null;
  try {
    const value = new Parser(tokens).parse();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

// --- unit conversion -------------------------------------------------

type UnitTable = Record<string, number>;

const LENGTH: UnitTable = {
  m: 1, meter: 1, meters: 1, metre: 1, metres: 1,
  km: 1000, kilometer: 1000, kilometers: 1000, kilometre: 1000, kilometres: 1000,
  cm: 0.01, centimeter: 0.01, centimeters: 0.01,
  mm: 0.001, millimeter: 0.001, millimeters: 0.001,
  um: 1e-6, micron: 1e-6, microns: 1e-6,
  nm: 1e-9,
  mi: 1609.344, mile: 1609.344, miles: 1609.344,
  yd: 0.9144, yard: 0.9144, yards: 0.9144,
  ft: 0.3048, foot: 0.3048, feet: 0.3048,
  in: 0.0254, inch: 0.0254, inches: 0.0254,
  nmi: 1852, 'nautical-mile': 1852,
  ly: 9.4607e15, 'light-year': 9.4607e15,
  au: 1.495978707e11,
};

const MASS: UnitTable = {
  kg: 1, kilogram: 1, kilograms: 1, kilo: 1, kilos: 1,
  g: 0.001, gram: 0.001, grams: 0.001,
  mg: 1e-6, milligram: 1e-6, milligrams: 1e-6,
  t: 1000, tonne: 1000, tonnes: 1000, 'metric-ton': 1000,
  lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237,
  oz: 0.028349523125, ounce: 0.028349523125, ounces: 0.028349523125,
  st: 6.35029318, stone: 6.35029318,
};

const TIME: UnitTable = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  ms: 0.001, millisecond: 0.001, milliseconds: 0.001,
  min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  d: 86400, day: 86400, days: 86400,
  wk: 604800, week: 604800, weeks: 604800,
  yr: 31557600, year: 31557600, years: 31557600,
};

const DATA: UnitTable = {
  b: 1, byte: 1, bytes: 1,
  kb: 1e3, kilobyte: 1e3, kilobytes: 1e3,
  mb: 1e6, megabyte: 1e6, megabytes: 1e6,
  gb: 1e9, gigabyte: 1e9, gigabytes: 1e9,
  tb: 1e12, terabyte: 1e12, terabytes: 1e12,
  pb: 1e15,
  kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
  bit: 0.125, bits: 0.125,
};

const SPEED: UnitTable = {
  'm/s': 1, mps: 1,
  'km/h': 1 / 3.6, kmh: 1 / 3.6, kph: 1 / 3.6,
  mph: 0.44704, 'mi/h': 0.44704,
  knot: 0.514444, knots: 0.514444, kn: 0.514444,
  'ft/s': 0.3048,
};

const TABLES: Array<{ name: string; table: UnitTable }> = [
  { name: 'length', table: LENGTH },
  { name: 'mass', table: MASS },
  { name: 'time', table: TIME },
  { name: 'data', table: DATA },
  { name: 'speed', table: SPEED },
];

const TEMPERATURE = new Set([
  'c', 'celsius', 'centigrade', '°c',
  'f', 'fahrenheit', '°f',
  'k', 'kelvin',
]);

function canonicalTemp(u: string): 'c' | 'f' | 'k' | null {
  const s = u.replace('°', '').replace(/^deg(rees)?/, '');
  if (['c', 'celsius', 'centigrade'].includes(s)) return 'c';
  if (['f', 'fahrenheit'].includes(s)) return 'f';
  if (['k', 'kelvin'].includes(s)) return 'k';
  return null;
}

function convertTemp(value: number, from: 'c' | 'f' | 'k', to: 'c' | 'f' | 'k'): number {
  const celsius = from === 'c' ? value : from === 'f' ? ((value - 32) * 5) / 9 : value - 273.15;
  return to === 'c' ? celsius : to === 'f' ? (celsius * 9) / 5 + 32 : celsius + 273.15;
}

const UNIT_LABEL: Record<string, string> = { c: '°C', f: '°F', k: 'K' };

function tryUnitConversion(query: string): CalculationResult | null {
  const m =
    /^(?:convert\s+|how (?:much|many)\s+(?:is\s+)?)?(-?[\d.,]+)\s*([a-zA-Z°/]+)\s+(?:to|in|into|as)\s+([a-zA-Z°/]+)\??$/.exec(
      query.trim(),
    );
  if (!m) return null;
  const amount = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  const fromRaw = m[2]!.toLowerCase();
  const toRaw = m[3]!.toLowerCase();

  const fromTemp = canonicalTemp(fromRaw);
  const toTemp = canonicalTemp(toRaw);
  if ((TEMPERATURE.has(fromRaw) || fromTemp) && (TEMPERATURE.has(toRaw) || toTemp)) {
    if (!fromTemp || !toTemp) return null;
    const value = convertTemp(amount, fromTemp, toTemp);
    return {
      kind: 'unit-conversion',
      expression: `${formatNumber(amount)} ${UNIT_LABEL[fromTemp]} in ${UNIT_LABEL[toTemp]}`,
      value: round(value, 4),
      formatted: `${formatNumber(round(value, 4))} ${UNIT_LABEL[toTemp]}`,
    };
  }

  for (const { name, table } of TABLES) {
    if (table[fromRaw] !== undefined && table[toRaw] !== undefined) {
      const value = (amount * table[fromRaw]!) / table[toRaw]!;
      return {
        kind: 'unit-conversion',
        expression: `${formatNumber(amount)} ${fromRaw} in ${toRaw}`,
        value: round(value),
        formatted: `${formatNumber(value)} ${toRaw}`,
        detail: `${name} conversion`,
      };
    }
  }
  return null;
}

// --- percentages ----------------------------------------------------

function tryPercentage(query: string): CalculationResult | null {
  const q = query.trim().replace(/\?+$/, '');

  let m = /^(?:what(?:'s| is)\s+)?(-?[\d.,]+)\s*(?:%|percent)\s+of\s+(-?[\d.,]+)$/i.exec(q);
  if (m) {
    const p = Number(m[1]!.replace(/,/g, ''));
    const base = Number(m[2]!.replace(/,/g, ''));
    const value = (p / 100) * base;
    return {
      kind: 'percentage',
      expression: `${formatNumber(p)}% of ${formatNumber(base)}`,
      value: round(value),
      formatted: formatNumber(value),
    };
  }

  m = /^(-?[\d.,]+)\s+(?:is what percent of|as a (?:percent|percentage) of)\s+(-?[\d.,]+)$/i.exec(q);
  if (m) {
    const part = Number(m[1]!.replace(/,/g, ''));
    const whole = Number(m[2]!.replace(/,/g, ''));
    if (whole === 0) return null;
    const value = (part / whole) * 100;
    return {
      kind: 'percentage',
      expression: `${formatNumber(part)} as a percentage of ${formatNumber(whole)}`,
      value: round(value, 4),
      formatted: `${formatNumber(round(value, 4))}%`,
    };
  }

  m = /^(-?[\d.,]+)\s+(increased|decreased|up|down|plus|minus)\s+by\s+(-?[\d.,]+)\s*(?:%|percent)$/i.exec(
    q,
  );
  if (m) {
    const base = Number(m[1]!.replace(/,/g, ''));
    const pct = Number(m[3]!.replace(/,/g, ''));
    const sign = /decreased|down|minus/i.test(m[2]!) ? -1 : 1;
    const value = base * (1 + (sign * pct) / 100);
    return {
      kind: 'percentage',
      expression: `${formatNumber(base)} ${sign < 0 ? '−' : '+'} ${formatNumber(pct)}%`,
      value: round(value),
      formatted: formatNumber(value),
    };
  }

  return null;
}

// --- entry point ----------------------------------------------------

const MAX_LEN = 120;

/** Try to answer `query` as a calculation. Returns `null` for anything that
 *  isn't unambiguously arithmetic / a percentage / a unit conversion. */
export function tryCalculate(query: string): CalculationResult | null {
  const q = query.trim();
  if (q.length === 0 || q.length > MAX_LEN) return null;

  const pct = tryPercentage(q);
  if (pct) return pct;

  const conv = tryUnitConversion(q);
  if (conv) return conv;

  // Arithmetic — strip a leading "what is / calculate / compute / =".
  const stripped = q
    .replace(/^(?:what(?:'s| is)|calculate|compute|eval(?:uate)?|solve)\s+/i, '')
    .replace(/^=\s*/, '')
    .replace(/[=?]+\s*$/, '')
    .trim();
  const value = evalArithmetic(stripped);
  if (value === null) return null;
  return {
    kind: 'arithmetic',
    expression: stripped.replace(/\s+/g, ' '),
    value: round(value),
    formatted: formatNumber(value),
  };
}

/** Render a {@link CalculationResult} as a one-line answer string. */
export function formatCalculation(result: CalculationResult): string {
  return `${result.expression} = ${result.formatted}`;
}
