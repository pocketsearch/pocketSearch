import { tokenize } from '../../text.js';
import { fetchJson } from './base.js';
import { lexicalRelevance, makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

interface NpmSearchResponse {
  objects?: Array<{
    package: {
      name: string;
      version?: string;
      description?: string;
      keywords?: string[];
      date?: string;
      links?: { npm?: string; homepage?: string; repository?: string };
      publisher?: { username?: string };
    };
    score?: { final?: number };
  }>;
}

/**
 * The npm registry search API. No key. Best for JavaScript / TypeScript package,
 * library and tool queries; results carry the description, latest version and a
 * relevance score from npm itself.
 */
export class NpmProvider implements SearchProvider {
  readonly name = 'npm';
  readonly category = 'code' as const;
  readonly priority = 5;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = [];
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 6000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    const url =
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}` +
      `&size=${Math.min(Math.max(ctx.limit, 5), 20)}`;
    const body = await fetchJson<NpmSearchResponse>(url, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
    });
    return (body.objects ?? []).map(({ package: pkg, score }) => {
      const meta = [
        pkg.version ? `v${pkg.version}` : null,
        pkg.date ? `updated ${pkg.date.slice(0, 10)}` : null,
        pkg.publisher?.username ? `by ${pkg.publisher.username}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return makeResult({
        title: `${pkg.name} (npm)`,
        url: pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
        snippet: pkg.description ? `${pkg.description} — ${meta}` : meta,
        provider: this.name,
        origin: 'code',
        source: 'npmjs.com',
        tags: ['npm', 'package', ...(pkg.keywords ?? []).slice(0, 5)],
        score:
          0.3 +
          0.4 * lexicalRelevance(`${pkg.name} ${pkg.description ?? ''}`, terms) +
          0.25 * (score?.final ?? 0),
        archivedDate: pkg.date,
        terms,
      });
    });
  }
}

interface PyPiProject {
  info?: {
    name: string;
    version?: string;
    summary?: string;
    home_page?: string;
    project_url?: string;
    package_url?: string;
    author?: string;
    keywords?: string;
  };
}

/**
 * PyPI exact-project lookup. PyPI has no JSON search API, so this resolves the
 * query (and its first token) as a package name via the per-project JSON
 * endpoint — a precise hit when someone searches for a specific Python library.
 */
export class PyPiProvider implements SearchProvider {
  readonly name = 'PyPI';
  readonly category = 'code' as const;
  readonly priority = 6;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = [];
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    const candidates = new Set<string>();
    const normalized = query.trim().toLowerCase().replace(/\s+/g, '-');
    if (/^[a-z0-9._-]{1,100}$/.test(normalized)) candidates.add(normalized);
    const firstToken = terms[0];
    if (firstToken && /^[a-z0-9._-]{2,100}$/.test(firstToken)) candidates.add(firstToken);
    if (candidates.size === 0) return [];

    const found = await Promise.allSettled(
      [...candidates].map((name) =>
        fetchJson<PyPiProject>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
          timeoutMs: this.timeoutMs,
          signal: ctx.signal,
          fetchImpl: this.opts.fetchImpl,
        }),
      ),
    );

    const out: UnifiedResult[] = [];
    for (const result of found) {
      if (result.status !== 'fulfilled' || !result.value.info?.name) continue;
      const info = result.value.info;
      out.push(
        makeResult({
          title: `${info.name} (PyPI)`,
          url: info.package_url ?? `https://pypi.org/project/${info.name}/`,
          snippet: [info.summary, info.version ? `v${info.version}` : null, info.author ? `by ${info.author}` : null]
            .filter(Boolean)
            .join(' — '),
          provider: this.name,
          origin: 'code',
          source: 'pypi.org',
          tags: ['pypi', 'package'],
          score: 0.5 + 0.35 * lexicalRelevance(`${info.name} ${info.summary ?? ''}`, terms),
          terms,
        }),
      );
    }
    return out;
  }
}
