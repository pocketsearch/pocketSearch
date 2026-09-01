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

/** [from (inclusive), to (inclusive), approx year, human description] */
type Period = [string, string, number, string];

// Prefix era: annual changeover on 1 August 1983–1998, then six-monthly
// (1 March / 1 September) from 1999 until the current system began in Sept 2001.
const PREFIX_PERIODS: Record<string, Period> = {
  A: ['1983-08-01', '1984-07-31', 1983, 'August 1983 – July 1984'],
  B: ['1984-08-01', '1985-07-31', 1984, 'August 1984 – July 1985'],
  C: ['1985-08-01', '1986-07-31', 1985, 'August 1985 – July 1986'],
  D: ['1986-08-01', '1987-07-31', 1986, 'August 1986 – July 1987'],
  E: ['1987-08-01', '1988-07-31', 1987, 'August 1987 – July 1988'],
  F: ['1988-08-01', '1989-07-31', 1988, 'August 1988 – July 1989'],
  G: ['1989-08-01', '1990-07-31', 1989, 'August 1989 – July 1990'],
  H: ['1990-08-01', '1991-07-31', 1990, 'August 1990 – July 1991'],
  J: ['1991-08-01', '1992-07-31', 1991, 'August 1991 – July 1992'],
  K: ['1992-08-01', '1993-07-31', 1992, 'August 1992 – July 1993'],
  L: ['1993-08-01', '1994-07-31', 1993, 'August 1993 – July 1994'],
  M: ['1994-08-01', '1995-07-31', 1994, 'August 1994 – July 1995'],
  N: ['1995-08-01', '1996-07-31', 1995, 'August 1995 – July 1996'],
  P: ['1996-08-01', '1997-07-31', 1996, 'August 1996 – July 1997'],
  R: ['1997-08-01', '1998-07-31', 1997, 'August 1997 – July 1998'],
  S: ['1998-08-01', '1999-02-28', 1998, 'August 1998 – February 1999'],
  T: ['1999-03-01', '1999-08-31', 1999, 'March 1999 – August 1999'],
  V: ['1999-09-01', '2000-02-29', 1999, 'September 1999 – February 2000'],
  W: ['2000-03-01', '2000-08-31', 2000, 'March 2000 – August 2000'],
  X: ['2000-09-01', '2001-02-28', 2000, 'September 2000 – February 2001'],
  Y: ['2001-03-01', '2001-08-31', 2001, 'March 2001 – August 2001'],
};

// Suffix era: annual, mostly August–July. A ran Feb–Dec 1963, B–D calendar
// years, E was a short Jan–Jul 1967 before the changeover moved to 1 August.
const SUFFIX_PERIODS: Record<string, Period> = {
  A: ['1963-02-01', '1963-12-31', 1963, 'February – December 1963'],
  B: ['1964-01-01', '1964-12-31', 1964, 'calendar year 1964'],
  C: ['1965-01-01', '1965-12-31', 1965, 'calendar year 1965'],
  D: ['1966-01-01', '1966-12-31', 1966, 'calendar year 1966'],
  E: ['1967-01-01', '1967-07-31', 1967, 'January – July 1967'],
  F: ['1967-08-01', '1968-07-31', 1967, 'August 1967 – July 1968'],
  G: ['1968-08-01', '1969-07-31', 1968, 'August 1968 – July 1969'],
  H: ['1969-08-01', '1970-07-31', 1969, 'August 1969 – July 1970'],
  J: ['1970-08-01', '1971-07-31', 1970, 'August 1970 – July 1971'],
  K: ['1971-08-01', '1972-07-31', 1971, 'August 1971 – July 1972'],
  L: ['1972-08-01', '1973-07-31', 1972, 'August 1972 – July 1973'],
  M: ['1973-08-01', '1974-07-31', 1973, 'August 1973 – July 1974'],
  N: ['1974-08-01', '1975-07-31', 1974, 'August 1974 – July 1975'],
  P: ['1975-08-01', '1976-07-31', 1975, 'August 1975 – July 1976'],
  R: ['1976-08-01', '1977-07-31', 1976, 'August 1976 – July 1977'],
  S: ['1977-08-01', '1978-07-31', 1977, 'August 1977 – July 1978'],
  T: ['1978-08-01', '1979-07-31', 1978, 'August 1978 – July 1979'],
  V: ['1979-08-01', '1980-07-31', 1979, 'August 1979 – July 1980'],
  W: ['1980-08-01', '1981-07-31', 1980, 'August 1980 – July 1981'],
  X: ['1981-08-01', '1982-07-31', 1981, 'August 1981 – July 1982'],
  Y: ['1982-08-01', '1983-07-31', 1982, 'August 1982 – July 1983'],
};

function fromPeriod(letter: string, period: Period | undefined, reference: Date): PlateAge | null {
  if (!period) return null;
  const [from, to, approxYear, span] = period;
  return {
    identifier: letter,
    registeredFrom: from,
    registeredTo: to,
    approxYear,
    ageYears: yearsBetween(new Date(`${from}T00:00:00Z`), reference),
    description: `registered ${span}`,
  };
}

export function decodePrefixAge(letter: string, reference: Date): PlateAge | null {
  return fromPeriod(letter, PREFIX_PERIODS[letter], reference);
}

export function decodeSuffixAge(letter: string, reference: Date): PlateAge | null {
  return fromPeriod(letter, SUFFIX_PERIODS[letter], reference);
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
