import { tokenize } from '../../text.js';
import { fetchJson } from './base.js';
import { makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

/**
 * The Internet Archive Wayback Machine CDX API. No key. For a domain/URL query it
 * enumerates archived captures; for a text query it checks whether a matching
 * page was ever archived. Results are marked `archived`.
 */
export class WaybackProvider implements SearchProvider {
  readonly name = 'Wayback Machine';
  readonly category = 'archives' as const;
  readonly priority = 6;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = [
    'domain',
    'url',
    'organization',
    'filename',
    'academic_title',
    'phrase',
  ] as const;
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  private target(ctx: ProviderContext, query: string): { pattern: string; matchType: string } | null {
    const e = ctx.classification.entities;
    if (ctx.classification.type === 'url') {
      return { pattern: ctx.classification.value.replace(/^https?:\/\//, ''), matchType: 'prefix' };
    }
    if (ctx.classification.type === 'domain' || e.rootDomain) {
      return { pattern: `${e.rootDomain ?? ctx.classification.value}/*`, matchType: 'domain' };
    }
    const host = query.trim().match(/([a-z0-9-]+\.)+[a-z]{2,}/i)?.[0];
    if (host) return { pattern: `${host}/*`, matchType: 'domain' };
    return null;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    const t = this.target(ctx, query);
    if (!t) return [];
    const limit = Math.min(Math.max(ctx.limit, 10), 40);
    const url =
      `https://web.archive.org/cdx/search/cdx?output=json&fl=original,timestamp,mimetype,statuscode` +
      `&filter=statuscode:200&collapse=urlkey&limit=${limit}` +
      `&matchType=${t.matchType}&url=${encodeURIComponent(t.pattern)}`;
    const rows = await fetchJson<string[][]>(url, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
    });
    if (!Array.isArray(rows) || rows.length <= 1) return [];
    const [, ...data] = rows;
    return data
      .map((row): UnifiedResult | null => {
        const [original, timestamp] = row;
        if (!original || !timestamp) return null;
        const snapshot = `https://web.archive.org/web/${timestamp}/${original}`;
        const date = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
        return makeResult({
          title: original.replace(/^https?:\/\//, ''),
          url: snapshot,
          snippet: `Archived capture of ${original} from ${date}.`,
          provider: this.name,
          origin: 'archive',
          source: 'web.archive.org',
          tags: ['archived'],
          archived: true,
          archivedDate: date,
          score: 0.35,
          terms,
        });
      })
      .filter((r): r is UnifiedResult => r !== null);
  }
}
