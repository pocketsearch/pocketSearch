import { tokenize } from '../../text.js';
import { fetchJson } from './base.js';
import { lexicalRelevance, makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

interface GitHubRepoSearch {
  items?: Array<{
    full_name: string;
    html_url: string;
    description?: string | null;
    language?: string | null;
    stargazers_count?: number;
    forks_count?: number;
    pushed_at?: string;
    topics?: string[];
    archived?: boolean;
  }>;
}

/**
 * GitHub repository search via the REST API. No token (unauthenticated search is
 * rate-limited to ~10 req/min — the circuit breaker backs off on 403). Best for
 * repository / username / library / tool queries.
 */
export class GitHubProvider implements SearchProvider {
  readonly name = 'GitHub';
  readonly category = 'code' as const;
  readonly priority = 4;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = [];
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 6000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const terms = tokenize(query);
    const cls = ctx.classification;
    const q =
      cls.type === 'repository' && cls.entities.repo
        ? `repo:${cls.entities.repo}`
        : cls.type === 'username'
          ? `user:${cls.value} ${cls.value}`
          : query;
    const url =
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}` +
      `&sort=stars&order=desc&per_page=${Math.min(Math.max(ctx.limit, 5), 20)}`;
    const body = await fetchJson<GitHubRepoSearch>(url, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'BeaconSearchBot/1.0 (discovery)',
        'x-github-api-version': '2022-11-28',
      },
    });
    return (body.items ?? []).map((repo) => {
      const meta = [
        repo.language || null,
        typeof repo.stargazers_count === 'number' ? `★ ${repo.stargazers_count}` : null,
        repo.pushed_at ? `updated ${repo.pushed_at.slice(0, 10)}` : null,
        repo.archived ? 'archived' : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return makeResult({
        title: repo.full_name,
        url: repo.html_url,
        snippet: repo.description ? `${repo.description} — ${meta}` : meta,
        provider: this.name,
        origin: 'code',
        source: 'github.com',
        tags: ['github', 'repository', ...(repo.topics ?? []).slice(0, 5)],
        score:
          0.3 +
          0.4 * lexicalRelevance(`${repo.full_name} ${repo.description ?? ''}`, terms) +
          Math.min(0.25, (repo.stargazers_count ?? 0) / 20000),
        archivedDate: repo.pushed_at,
        terms,
      });
    });
  }
}
