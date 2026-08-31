import { z } from 'zod';

/** A document stored in the Beacon Search index. */
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

/** Input accepted when creating or updating a document. */
export const documentInputSchema = z.object({
  id: z.string().trim().min(1).max(512).optional(),
  title: z.string().trim().min(1).max(1024),
  body: z.string().max(5_000_000).default(''),
  url: z.string().trim().url().max(2048).optional(),
  tags: z.array(z.string().trim().min(1).max(128)).max(64).default([]),
  source: z.string().trim().min(1).max(256).optional(),
});
export type DocumentInput = z.infer<typeof documentInputSchema>;

export const bulkInputSchema = z.object({
  documents: z.array(documentInputSchema).min(1).max(10_000),
});

export const searchQuerySchema = z.object({
  q: z.string().max(1024).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]))
    .pipe(z.array(z.string().trim().min(1)).max(32)),
  source: z.string().trim().min(1).max(256).optional(),
  fuzzy: z.coerce.boolean().default(true),
  prefix: z.coerce.boolean().default(true),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const crawlInputSchema = z.object({
  url: z.string().trim().url(),
  maxPages: z.coerce.number().int().min(1).max(2000).optional(),
  sameOriginOnly: z.coerce.boolean().default(true),
  tags: z.array(z.string().trim().min(1).max(128)).max(32).default([]),
});
export type CrawlInput = z.infer<typeof crawlInputSchema>;

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
  facets: {
    tags: Record<string, number>;
    sources: Record<string, number>;
  };
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

/** On-disk index snapshot format. `version` guards against breaking changes. */
export interface IndexSnapshot {
  version: 1;
  savedAt: string;
  documents: BeaconDocument[];
}
