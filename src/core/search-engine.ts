import { randomUUID } from 'node:crypto';
import MiniSearch from 'minisearch';
import { highlight, makeSnippet, normalizeWhitespace, tokenize } from './text.js';
import type {
  BeaconDocument,
  DocumentInput,
  IndexSnapshot,
  IndexStats,
  SearchHit,
  SearchQuery,
  SearchResponse,
} from './types.js';

interface IndexedDoc {
  id: string;
  title: string;
  body: string;
  tags: string;
}

export interface SearchEngineEvents {
  /** Called after any mutation (upsert / remove / bulk load). */
  onChange?: () => void;
}

function slugify(input: string): string {
  return normalizeWhitespace(input)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * In-memory full-text search index built on MiniSearch, with the original
 * documents kept alongside so results can carry snippets and metadata.
 */
export class SearchEngine {
  private mini: MiniSearch<IndexedDoc>;
  private readonly docs = new Map<string, BeaconDocument>();
  private readonly onChange?: () => void;
  lastPersistedAt: string | null = null;

  constructor(events: SearchEngineEvents = {}) {
    this.onChange = events.onChange;
    this.mini = SearchEngine.createIndex();
  }

  private static createIndex(): MiniSearch<IndexedDoc> {
    return new MiniSearch<IndexedDoc>({
      idField: 'id',
      fields: ['title', 'body', 'tags'],
      storeFields: [],
      searchOptions: {
        boost: { title: 3, tags: 2 },
        combineWith: 'AND',
      },
    });
  }

  private toIndexed(doc: BeaconDocument): IndexedDoc {
    return { id: doc.id, title: doc.title, body: doc.body, tags: doc.tags.join(' ') };
  }

  get size(): number {
    return this.docs.size;
  }

  has(id: string): boolean {
    return this.docs.has(id);
  }

  get(id: string): BeaconDocument | undefined {
    return this.docs.get(id);
  }

  list(): BeaconDocument[] {
    return [...this.docs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Insert or replace a document. Returns the stored document. */
  upsert(input: DocumentInput): BeaconDocument {
    const now = new Date().toISOString();
    const id = input.id?.trim() || slugify(input.title) || randomUUID();
    const existing = this.docs.get(id);

    const doc: BeaconDocument = {
      id,
      title: normalizeWhitespace(input.title),
      body: input.body ?? '',
      url: input.url,
      tags: [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))],
      source: input.source,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existing) this.mini.discard(id);
    this.docs.set(id, doc);
    this.mini.add(this.toIndexed(doc));
    this.onChange?.();
    return doc;
  }

  remove(id: string): boolean {
    if (!this.docs.has(id)) return false;
    this.mini.discard(id);
    this.docs.delete(id);
    this.onChange?.();
    return true;
  }

  clear(): void {
    this.docs.clear();
    this.mini = SearchEngine.createIndex();
    this.onChange?.();
  }

  /** Replace the entire index contents (used when loading a snapshot). */
  replaceAll(documents: BeaconDocument[]): void {
    this.docs.clear();
    this.mini = SearchEngine.createIndex();
    for (const doc of documents) {
      this.docs.set(doc.id, doc);
    }
    this.mini.addAll([...this.docs.values()].map((doc) => this.toIndexed(doc)));
    this.onChange?.();
  }

  search(query: SearchQuery): SearchResponse {
    const startedAt = performance.now();
    const q = query.q.trim();
    const queryTerms = tokenize(q);

    let ranked: Array<{ doc: BeaconDocument; score: number; terms: string[] }>;

    if (q.length === 0) {
      ranked = this.list().map((doc) => ({ doc, score: 0, terms: [] }));
    } else {
      ranked = this.mini
        .search(q, {
          prefix: query.prefix,
          fuzzy: query.fuzzy ? 0.2 : false,
          boost: { title: 3, tags: 2 },
        })
        .map((result) => {
          const doc = this.docs.get(String(result.id));
          if (!doc) return null;
          const terms = [...new Set([...result.terms, ...queryTerms])];
          return { doc, score: result.score, terms };
        })
        .filter((v): v is { doc: BeaconDocument; score: number; terms: string[] } => v !== null);
    }

    const filtered = ranked.filter(({ doc }) => {
      if (query.source && doc.source !== query.source) return false;
      if (query.tags.length > 0 && !query.tags.every((tag) => doc.tags.includes(tag))) return false;
      return true;
    });

    const facets = { tags: {} as Record<string, number>, sources: {} as Record<string, number> };
    for (const { doc } of filtered) {
      for (const tag of doc.tags) facets.tags[tag] = (facets.tags[tag] ?? 0) + 1;
      if (doc.source) facets.sources[doc.source] = (facets.sources[doc.source] ?? 0) + 1;
    }

    const page = filtered.slice(query.offset, query.offset + query.limit);
    const hits: SearchHit[] = page.map(({ doc, score, terms }) => ({
      id: doc.id,
      score: Number(score.toFixed(4)),
      title: highlight(doc.title, terms),
      url: doc.url,
      tags: doc.tags,
      source: doc.source,
      snippet: highlight(makeSnippet(doc.body, terms), terms),
      terms,
    }));

    return {
      query: q,
      total: filtered.length,
      limit: query.limit,
      offset: query.offset,
      tookMs: Number((performance.now() - startedAt).toFixed(2)),
      hits,
      facets,
    };
  }

  stats(indexFile: string): IndexStats {
    const tagCounts = new Map<string, number>();
    const sourceCounts = new Map<string, number>();
    for (const doc of this.docs.values()) {
      for (const tag of doc.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      if (doc.source) sourceCounts.set(doc.source, (sourceCounts.get(doc.source) ?? 0) + 1);
    }
    const top = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20);

    return {
      documents: this.docs.size,
      tags: tagCounts.size,
      sources: sourceCounts.size,
      topTags: top(tagCounts).map(([tag, count]) => ({ tag, count })),
      topSources: top(sourceCounts).map(([source, count]) => ({ source, count })),
      indexFile,
      lastPersistedAt: this.lastPersistedAt,
    };
  }

  toSnapshot(): IndexSnapshot {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      documents: [...this.docs.values()],
    };
  }
}
