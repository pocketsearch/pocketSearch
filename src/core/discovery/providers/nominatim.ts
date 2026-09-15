import { tokenize } from '../../text.js';
import { fetchJson } from './base.js';
import { lexicalRelevance, makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

interface NominatimPlace {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  class?: string;
  addresstype?: string;
  importance?: number;
  osm_type?: string;
  osm_id?: number;
}

const PLACE_HINTS =
  /\b(where|located|location|city|town|village|country|capital|address|street|map|near|region|province|county|mountain|river|lake|island|park|airport|station)\b/i;

/**
 * OpenStreetMap Nominatim geocoding. No key (usage policy asks for a UA and
 * ≤ 1 req/s — the circuit breaker enforces backoff on 429). Runs only for
 * place-like queries so it doesn't add noise to everything else.
 */
export class NominatimProvider implements SearchProvider {
  readonly name = 'OpenStreetMap';
  readonly category = 'reference' as const;
  readonly priority = 6;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = [];
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 6000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    // Only bother for text queries that read like a place.
    if (!['text', 'phrase'].includes(ctx.classification.type)) return [];
    if (terms.length > 8 && !PLACE_HINTS.test(query)) return [];

    const url =
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}` +
      `&format=jsonv2&addressdetails=0&limit=${Math.min(Math.max(ctx.limit, 3), 10)}`;
    const rows = await fetchJson<NominatimPlace[]>(url, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
      headers: { 'user-agent': 'BeaconSearchBot/1.0 (discovery; +https://github.com/pocketsearch/pocketSearch)' },
    });

    if (!PLACE_HINTS.test(query) && (rows.length === 0 || (rows[0]?.importance ?? 0) < 0.4)) {
      return []; // weak match on a non-place query — stay quiet
    }

    return rows.map((place) => {
      const kind = place.addresstype ?? place.type ?? place.class ?? 'place';
      return makeResult({
        title: place.display_name.split(',').slice(0, 3).join(', '),
        url: `https://www.openstreetmap.org/${place.osm_type ?? 'node'}/${place.osm_id ?? place.place_id}`,
        snippet: `${kind} · ${place.display_name} · ${Number(place.lat).toFixed(4)}, ${Number(place.lon).toFixed(4)}`,
        provider: this.name,
        origin: 'web',
        source: 'openstreetmap.org',
        tags: ['place', kind.replace(/\s+/g, '-')],
        score: 0.35 + 0.4 * lexicalRelevance(place.display_name, terms) + Math.min(0.2, place.importance ?? 0),
        terms,
      });
    });
  }
}
