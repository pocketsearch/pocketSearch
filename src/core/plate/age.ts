import type { PlateAge, PlateFormat } from './types.js';

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function yearsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round(((to.getTime() - from.getTime()) / (365.25 * 864e5)) * 10) / 10);
}

/**
 * Decode the two-digit age identifier of a current-style plate (2001-present).
 *
 * March–August of year `YY`  → identifier `YY`   (e.g. 2012 → "12")
 * September–February         → identifier `YY+50` (e.g. 2012/13 → "62")
 */
export function decodeCurrentAge(identifier: string, reference: Date): PlateAge | null {
  if (!/^[0-9]{2}$/.test(identifier)) return null;
  const n = Number(identifier);

  let year: number;
  let startMonth: number;
  if (n >= 2 && n <= 49) {
    year = 2000 + n;
    startMonth = 3; // March
  } else if (n >= 51 && n <= 99) {
    year = 2000 + (n - 50);
    startMonth = 9; // September (registration period spans into the next year)
  } else {
    return null;
  }

  const registeredFrom = new Date(Date.UTC(year, startMonth - 1, 1));
  const registeredTo =
    startMonth === 3
      ? new Date(Date.UTC(year, 8, 0)) // 31 Aug of the same year
      : new Date(Date.UTC(year + 1, 2, 0)); // end of Feb next year

  if (registeredFrom.getTime() > reference.getTime()) return null; // future plate

  return {
    identifier,
    registeredFrom: iso(registeredFrom),
    registeredTo: iso(registeredTo),
    approxYear: year,
    ageYears: yearsBetween(registeredFrom, reference),
    description:
      startMonth === 3
        ? `registered March–August ${year}`
        : `registered September ${year} – February ${year + 1}`,
  };
}

// Prefix era (1983–2001): leading letter → 12-month period starting 1 August.
const PREFIX_LETTERS = 'ABCDEFGHJKLMNPRSTVWXY'; // no I, O, Q, U, Z
// Suffix era (1963–1983): trailing letter → period. A=1963; letters roughly annual,
// with the changeover moving to 1 August from 1967 (E onward).
const SUFFIX_LETTERS = 'ABCDEFGHJKLMNPRSTVWXY';

export function decodePrefixAge(letter: string, reference: Date): PlateAge | null {
  const idx = PREFIX_LETTERS.indexOf(letter);
  if (idx === -1) return null;
  const startYear = 1983 + idx;
  const registeredFrom = new Date(Date.UTC(startYear, 7, 1)); // 1 Aug
  const registeredTo = new Date(Date.UTC(startYear + 1, 6, 31));
  return {
    identifier: letter,
    registeredFrom: iso(registeredFrom),
    registeredTo: iso(registeredTo),
    approxYear: startYear,
    ageYears: yearsBetween(registeredFrom, reference),
    description: `registered August ${startYear} – July ${startYear + 1}`,
  };
}

export function decodeSuffixAge(letter: string, reference: Date): PlateAge | null {
  const idx = SUFFIX_LETTERS.indexOf(letter);
  if (idx === -1) return null;

  // A–D (1963–66) ran to the calendar year; E was a half-year (Jan–Jul 1967);
  // from F (Aug 1967) the annual period ran August–July.
  let registeredFrom: Date;
  let registeredTo: Date;
  let approxYear: number;
  let description: string;

  if (idx <= 3) {
    approxYear = 1963 + idx;
    registeredFrom = new Date(Date.UTC(approxYear, 0, 1));
    registeredTo = new Date(Date.UTC(approxYear, 11, 31));
    description = `registered during ${approxYear}`;
  } else if (idx === 4) {
    approxYear = 1967;
    registeredFrom = new Date(Date.UTC(1967, 0, 1));
    registeredTo = new Date(Date.UTC(1967, 6, 31));
    description = 'registered January–July 1967';
  } else {
    approxYear = 1967 + (idx - 5);
    registeredFrom = new Date(Date.UTC(approxYear, 7, 1));
    registeredTo = new Date(Date.UTC(approxYear + 1, 6, 31));
    description = `registered August ${approxYear} – July ${approxYear + 1}`;
  }

  return {
    identifier: letter,
    registeredFrom: iso(registeredFrom),
    registeredTo: iso(registeredTo),
    approxYear,
    ageYears: yearsBetween(registeredFrom, reference),
    description,
  };
}

export function decodeAge(
  normalized: string,
  format: PlateFormat,
  reference: Date,
): PlateAge | null {
  switch (format) {
    case 'current':
      return decodeCurrentAge(normalized.slice(2, 4), reference);
    case 'prefix':
      return decodePrefixAge(normalized[0] ?? '', reference);
    case 'suffix':
      return decodeSuffixAge(normalized[normalized.length - 1] ?? '', reference);
    default:
      return null;
  }
}
