import { tokenize } from '../../text.js';
import { fetchJson } from './base.js';
import { lexicalRelevance, makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

interface OpenAlexWork {
  id: string;
  title?: string;
  display_name?: string;
  doi?: string;
  publication_year?: number;
  cited_by_count?: number;
  primary_location?: { landing_page_url?: string; source?: { display_name?: string } };
  authorships?: Array<{ author?: { display_name?: string } }>;
  abstract_inverted_index?: Record<string, number[]>;
}

interface OpenAlexResponse {
  results?: OpenAlexWork[];
}

/** Reconstruct plain-text abstract from OpenAlex's inverted index. */
function abstractFromIndex(index: Record<string, number[]> | undefined): string {
  if (!index) return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(' ').slice(0, 400);
}

/**
 * OpenAlex — an open index of scholarly works. No key (the polite pool just asks
 * for a contact in the UA). Best for academic-title / DOI / research-topic
 * queries; results carry citation counts and a landing page or DOI link.
 */
export class OpenAlexProvider implements SearchProvider {
  readonly name = 'OpenAlex';
  readonly category = 'academic' as const;
  readonly priority = 5;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = [];
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 7000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    const cls = ctx.classification;
    const perPage = Math.min(Math.max(ctx.limit, 5), 20);
    const url =
      cls.type === 'doi'
        ? `https://api.openalex.org/works/doi:${encodeURIComponent(cls.value)}`
        : `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${perPage}` +
          '&sort=relevance_score:desc';

    const body = await fetchJson<OpenAlexResponse | OpenAlexWork>(url, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
      headers: { 'user-agent': 'BeaconSearchBot/1.0 (discovery; mailto:beacon@example.invalid)' },
    });

    const rows: OpenAlexWork[] =
      body && 'results' in body ? (body.results ?? []) : [body as OpenAlexWork];

    return rows
      .filter((row) => row && (row.title || row.display_name))
      .slice(0, perPage)
      .map((row) => {
        const title = (row.title || row.display_name) as string;
        const authors = (row.authorships ?? [])
          .map((a) => a.author?.display_name)
          .filter(Boolean)
          .slice(0, 3)
          .join(', ');
        const venue = row.primary_location?.source?.display_name;
        const abstract = abstractFromIndex(row.abstract_inverted_index);
        const link =
          row.primary_location?.landing_page_url ??
          (row.doi ? `https://doi.org/${row.doi.replace(/^https?:\/\/doi\.org\//, '')}` : row.id);
        const meta = [
          authors || null,
          row.publication_year ? String(row.publication_year) : null,
          venue || null,
          typeof row.cited_by_count === 'number' ? `${row.cited_by_count} citations` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return makeResult({
          title,
          url: link,
          snippet: abstract || meta,
          provider: this.name,
          origin: 'academic',
          source: 'openalex.org',
          tags: ['academic', 'paper'],
          score:
            0.35 +
            0.4 * lexicalRelevance(`${title} ${abstract}`, terms) +
            Math.min(0.2, (row.cited_by_count ?? 0) / 5000),
          archivedDate: row.publication_year ? `${row.publication_year}-01-01` : undefined,
          terms,
        });
      });
  }
}
