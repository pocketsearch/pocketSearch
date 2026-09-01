import type { PlateRegion } from './types.js';

type Country = PlateRegion['country'];

interface OfficeRange {
  from: string; // inclusive second letter
  to: string; // inclusive second letter
  office: string;
}

interface RegionEntry {
  region: string;
  country: Country;
  offices: OfficeRange[];
}

/**
 * DVLA "memory tag" table for current-style plates (2001-present). The first
 * letter identifies the region, the second the former local registration
 * office. Source: DVLA / Driver & Vehicle Standards Agency published data.
 */
const MEMORY_TAGS: Record<string, RegionEntry> = {
  A: {
    region: 'Anglia',
    country: 'England',
    offices: [
      { from: 'A', to: 'N', office: 'Peterborough' },
      { from: 'O', to: 'U', office: 'Norwich' },
      { from: 'V', to: 'Y', office: 'Ipswich' },
    ],
  },
  B: {
    region: 'Birmingham',
    country: 'England',
    offices: [{ from: 'A', to: 'Y', office: 'Birmingham' }],
  },
  C: {
    region: 'Cymru (Wales)',
    country: 'Wales',
    offices: [
      { from: 'A', to: 'O', office: 'Cardiff' },
      { from: 'P', to: 'V', office: 'Swansea' },
      { from: 'W', to: 'Y', office: 'Bangor' },
    ],
  },
  D: {
    region: 'Deeside to Shrewsbury',
    country: 'England',
    offices: [
      { from: 'A', to: 'K', office: 'Chester' },
      { from: 'L', to: 'Y', office: 'Shrewsbury' },
    ],
  },
  E: {
    region: 'Essex',
    country: 'England',
    offices: [{ from: 'A', to: 'Y', office: 'Chelmsford' }],
  },
  F: {
    region: 'Forest and Fens',
    country: 'England',
    offices: [
      { from: 'A', to: 'P', office: 'Nottingham' },
      { from: 'R', to: 'Y', office: 'Lincoln' },
    ],
  },
  G: {
    region: 'Garden of England',
    country: 'England',
    offices: [
      { from: 'A', to: 'O', office: 'Maidstone' },
      { from: 'P', to: 'Y', office: 'Brighton' },
    ],
  },
  H: {
    region: 'Hampshire and Dorset',
    country: 'England',
    offices: [
      { from: 'A', to: 'J', office: 'Bournemouth' },
      { from: 'K', to: 'Y', office: 'Portsmouth' },
    ],
  },
  K: {
    region: 'Luton and Northampton',
    country: 'England',
    offices: [
      { from: 'A', to: 'L', office: 'Luton' },
      { from: 'M', to: 'Y', office: 'Northampton' },
    ],
  },
  L: {
    region: 'London',
    country: 'England',
    offices: [
      { from: 'A', to: 'J', office: 'Wimbledon' },
      { from: 'K', to: 'T', office: 'Stanmore' },
      { from: 'U', to: 'Y', office: 'Sidcup' },
    ],
  },
  M: {
    region: 'Manchester and Merseyside',
    country: 'England',
    offices: [{ from: 'A', to: 'Y', office: 'Manchester' }],
  },
  N: {
    region: 'North',
    country: 'England',
    offices: [
      { from: 'A', to: 'O', office: 'Newcastle' },
      { from: 'P', to: 'Y', office: 'Stockton' },
    ],
  },
  O: { region: 'Oxford', country: 'England', offices: [{ from: 'A', to: 'Y', office: 'Oxford' }] },
  P: {
    region: 'Preston',
    country: 'England',
    offices: [
      { from: 'A', to: 'T', office: 'Preston' },
      { from: 'U', to: 'Y', office: 'Carlisle' },
    ],
  },
  R: {
    region: 'Reading',
    country: 'England',
    offices: [{ from: 'A', to: 'Y', office: 'Reading' }],
  },
  S: {
    region: 'Scotland',
    country: 'Scotland',
    offices: [
      { from: 'A', to: 'J', office: 'Glasgow' },
      { from: 'K', to: 'O', office: 'Edinburgh' },
      { from: 'P', to: 'T', office: 'Dundee' },
      { from: 'U', to: 'W', office: 'Aberdeen' },
      { from: 'X', to: 'Y', office: 'Inverness' },
    ],
  },
  V: {
    region: 'Severn Valley',
    country: 'England',
    offices: [{ from: 'A', to: 'Y', office: 'Worcester' }],
  },
  W: {
    region: 'West of England',
    country: 'England',
    offices: [
      { from: 'A', to: 'J', office: 'Exeter' },
      { from: 'K', to: 'T', office: 'Truro' },
      { from: 'U', to: 'Y', office: 'Bristol' },
    ],
  },
  Y: {
    region: 'Yorkshire',
    country: 'England',
    offices: [
      { from: 'A', to: 'K', office: 'Leeds' },
      { from: 'L', to: 'U', office: 'Sheffield' },
      { from: 'V', to: 'Y', office: 'Beverley' },
    ],
  },
};

/** Resolve a two-letter current-style memory tag to a region + former office. */
export function lookupMemoryTag(tag: string): PlateRegion | null {
  const upper = tag.toUpperCase();
  const first = upper[0];
  const second = upper[1];
  if (!first || !second) return null;
  const entry = MEMORY_TAGS[first];
  if (!entry) return null;
  const office = entry.offices.find((o) => second >= o.from && second <= o.to);
  return {
    memoryTag: upper,
    region: entry.region,
    office: office?.office ?? entry.offices[0]?.office ?? 'Unknown',
    country: entry.country,
  };
}

export function knownMemoryTagLetters(): string[] {
  return Object.keys(MEMORY_TAGS);
}
