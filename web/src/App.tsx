import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type IndexStats, type SearchResponse } from './api';

type Tab = 'search' | 'add' | 'crawl' | 'about';

const PAGE_SIZE = 10;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('search');
  const [stats, setStats] = useState<IndexStats | null>(null);

  const refreshStats = useCallback(() => {
    api
      .stats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  useEffect(refreshStats, [refreshStats]);

  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">
          <span className="brand__mark" aria-hidden>
            🔦
          </span>
          <div>
            <h1>Beacon Search</h1>
            <p>Self-hostable open-source full-text search</p>
          </div>
        </div>
        <nav className="tabs" aria-label="Sections">
          {(
            [
              ['search', 'Search'],
              ['add', 'Add document'],
              ['crawl', 'Crawl site'],
              ['about', 'About'],
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'tabs__btn tabs__btn--active' : 'tabs__btn'}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app__main">
        {tab === 'search' && <SearchView />}
        {tab === 'add' && <AddView onDone={refreshStats} />}
        {tab === 'crawl' && <CrawlView onDone={refreshStats} />}
        {tab === 'about' && <AboutView />}
      </main>

      <footer className="app__footer">
        {stats ? (
          <span>
            {stats.documents.toLocaleString()} documents · {stats.tags} tags · {stats.sources}{' '}
            sources
          </span>
        ) : (
          <span>Index status unavailable</span>
        )}
        <a href="/api/health" target="_blank" rel="noreferrer">
          API health
        </a>
      </footer>
    </div>
  );
}

function SearchView(): JSX.Element {
  const [input, setInput] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const query = useDebounced(input, 200);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPage(0);
  }, [query, activeTags]);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    api
      .search(
        { q: query, limit: PAGE_SIZE, offset: page * PAGE_SIZE, tags: activeTags },
        controller.signal,
      )
      .then((res) => {
        setResult(res);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Search failed');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, page, activeTags]);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const facetTags = useMemo(
    () =>
      result
        ? Object.entries(result.facets.tags)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
        : [],
    [result],
  );

  const toggleTag = (tag: string) =>
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  return (
    <section className="search">
      <div className="search__box">
        <input
          type="search"
          autoFocus
          placeholder="Search the index…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-label="Search query"
        />
      </div>

      {activeTags.length > 0 && (
        <div className="chips">
          {activeTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="chip chip--active"
              onClick={() => toggleTag(tag)}
            >
              {tag} ✕
            </button>
          ))}
        </div>
      )}

      {error && <p className="notice notice--error">{error}</p>}

      {result && (
        <p className="search__meta">
          {result.total.toLocaleString()} result{result.total === 1 ? '' : 's'}
          {result.query ? ` for “${result.query}”` : ''} · {result.tookMs} ms
          {loading ? ' · updating…' : ''}
        </p>
      )}

      {facetTags.length > 0 && (
        <div className="chips chips--facets">
          {facetTags.map(([tag, count]) => (
            <button
              key={tag}
              type="button"
              className={activeTags.includes(tag) ? 'chip chip--active' : 'chip'}
              onClick={() => toggleTag(tag)}
            >
              {tag} <span className="chip__count">{count}</span>
            </button>
          ))}
        </div>
      )}

      <ol className="results">
        {result?.hits.map((hit) => (
          <li key={hit.id} className="result">
            <h3 className="result__title">
              {hit.url ? (
                <a href={hit.url} target="_blank" rel="noreferrer">
                  <span dangerouslySetInnerHTML={{ __html: hit.title }} />
                </a>
              ) : (
                <span dangerouslySetInnerHTML={{ __html: hit.title }} />
              )}
            </h3>
            {hit.url && <div className="result__url">{hit.url}</div>}
            <p className="result__snippet" dangerouslySetInnerHTML={{ __html: hit.snippet }} />
            <div className="result__foot">
              {hit.source && <span className="result__source">{hit.source}</span>}
              {hit.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="chip chip--sm"
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
              {hit.score > 0 && <span className="result__score">score {hit.score}</span>}
            </div>
          </li>
        ))}
      </ol>

      {result && result.total === 0 && !loading && (
        <p className="notice">No documents matched. Try a different query or add content.</p>
      )}

      {result && result.total > PAGE_SIZE && (
        <div className="pager">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ← Previous
          </button>
          <span>
            Page {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
}

function AddView({ onDone }: { onDone: () => void }): JSX.Element {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    api
      .addDocument({
        title: title.trim(),
        body,
        url: url.trim() || undefined,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      })
      .then((doc) => {
        setStatus({ kind: 'ok', text: `Indexed "${doc.title}" (id: ${doc.id})` });
        setTitle('');
        setBody('');
        setUrl('');
        setTags('');
        onDone();
      })
      .catch((err: unknown) =>
        setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'Failed' }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={1024} />
      </label>
      <label>
        URL (optional)
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          type="url"
          placeholder="https://…"
        />
      </label>
      <label>
        Tags (comma-separated)
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="docs, guide" />
      </label>
      <label>
        Body
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} />
      </label>
      <button type="submit" className="btn" disabled={busy || title.trim() === ''}>
        {busy ? 'Indexing…' : 'Add to index'}
      </button>
      {status && (
        <p className={status.kind === 'ok' ? 'notice notice--ok' : 'notice notice--error'}>
          {status.text}
        </p>
      )}
    </form>
  );
}

function CrawlView({ onDone }: { onDone: () => void }): JSX.Element {
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState('25');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    api
      .crawl({
        url: url.trim(),
        maxPages: Number(maxPages) || undefined,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      })
      .then((res) => {
        setStatus({
          kind: 'ok',
          text: `Crawled ${res.pagesCrawled} pages, indexed ${res.documentsIndexed}, ${res.errors.length} errors.`,
        });
        onDone();
      })
      .catch((err: unknown) =>
        setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'Crawl failed' }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <form className="form" onSubmit={submit}>
      <p className="notice">
        Fetches HTML pages starting from a URL, follows same-origin links and indexes the text.
        Respects <code>robots.txt</code>. Large crawls can take a while — the request completes when
        the crawl finishes.
      </p>
      <label>
        Start URL
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          type="url"
          required
          placeholder="https://example.com"
        />
      </label>
      <label>
        Max pages
        <input
          value={maxPages}
          onChange={(e) => setMaxPages(e.target.value)}
          type="number"
          min={1}
          max={2000}
        />
      </label>
      <label>
        Tags (comma-separated)
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="website" />
      </label>
      <button type="submit" className="btn" disabled={busy || url.trim() === ''}>
        {busy ? 'Crawling…' : 'Start crawl'}
      </button>
      {status && (
        <p className={status.kind === 'ok' ? 'notice notice--ok' : 'notice notice--error'}>
          {status.text}
        </p>
      )}
    </form>
  );
}

function AboutView(): JSX.Element {
  return (
    <section className="prose">
      <h2>About Beacon Search</h2>
      <p>
        Beacon Search is a small, dependency-light search engine you can run anywhere Node.js runs.
        It keeps a full-text index in memory (powered by MiniSearch) and persists it to a single
        JSON file — no database, no external services.
      </p>
      <h3>API</h3>
      <ul>
        <li>
          <code>GET /api/search?q=…&amp;tags=…&amp;limit=…&amp;offset=…</code>
        </li>
        <li>
          <code>GET /api/documents</code> · <code>GET /api/documents/:id</code>
        </li>
        <li>
          <code>POST /api/documents</code> · <code>PUT /api/documents/:id</code> ·{' '}
          <code>DELETE /api/documents/:id</code>
        </li>
        <li>
          <code>POST /api/documents/bulk</code> · <code>POST /api/crawl</code> ·{' '}
          <code>GET /api/stats</code>
        </li>
      </ul>
      <h3>CLI</h3>
      <p>
        <code>beacon serve</code>, <code>beacon add</code>, <code>beacon import file.json</code>,{' '}
        <code>beacon crawl https://…</code>, <code>beacon search &quot;query&quot;</code>,{' '}
        <code>beacon stats</code>
      </p>
    </section>
  );
}
