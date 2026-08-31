export interface SearchHit {
  id: string;
  score: number;
  title: string;
  url?: string;
  tags: string[];
  source?: string;
  snippet: string;
  terms: string[];
}

export interface SearchResponse {
  query: string;
  total: number;
  limit: number;
  offset: number;
  tookMs: number;
  hits: SearchHit[];
  facets: { tags: Record<string, number>; sources: Record<string, number> };
}

export interface IndexStats {
  documents: number;
  tags: number;
  sources: number;
  topTags: Array<{ tag: string; count: number }>;
  topSources: Array<{ source: string; count: number }>;
  indexFile: string;
  lastPersistedAt: string | null;
}

export interface BeaconDocument {
  id: string;
  title: string;
  body: string;
  url?: string;
  tags: string[];
  source?: string;
  createdAt: string;
  updatedAt: string;
}

const BASE = import.meta.env.VITE_API_BASE ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export interface SearchParams {
  q: string;
  limit?: number;
  offset?: number;
  tags?: string[];
  source?: string;
}

export const api = {
  search(params: SearchParams, signal?: AbortSignal): Promise<SearchResponse> {
    const qs = new URLSearchParams();
    qs.set('q', params.q);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.source) qs.set('source', params.source);
    for (const tag of params.tags ?? []) qs.append('tags', tag);
    return request<SearchResponse>(`/api/search?${qs.toString()}`, { signal });
  },
  stats(): Promise<IndexStats> {
    return request<IndexStats>('/api/stats');
  },
  addDocument(doc: {
    title: string;
    body: string;
    url?: string;
    tags: string[];
    source?: string;
  }): Promise<BeaconDocument> {
    return request<BeaconDocument>('/api/documents', {
      method: 'POST',
      body: JSON.stringify(doc),
    });
  },
  deleteDocument(id: string): Promise<void> {
    return request<void>(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  crawl(input: { url: string; maxPages?: number; tags?: string[] }): Promise<{
    startUrl: string;
    pagesCrawled: number;
    documentsIndexed: number;
    errors: Array<{ url: string; error: string }>;
    skipped: Array<{ url: string; reason: string }>;
  }> {
    return request('/api/crawl', { method: 'POST', body: JSON.stringify(input) });
  },
  clearIndex(): Promise<{ ok: boolean; documents: number }> {
    return request('/api/index/clear', { method: 'POST' });
  },
};
