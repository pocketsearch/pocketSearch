export interface CacheEntry<T> {
  value: T;
  storedAt: number;
  /** Soft expiry — after this the entry is `stale` but still returned as a
   *  fallback when a fresh search cannot be produced. */
  freshUntil: number;
  /** Hard expiry — after this the entry is dropped. */
  hardUntil: number;
}

export interface CacheHit<T> {
  value: T;
  stale: boolean;
  storedAt: number;
}

/**
 * Tiny in-memory TTL cache with stale-while-error semantics. Bounded by entry
 * count (LRU-ish via insertion order). No external dependency.
 */
export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly freshMs: number,
    private readonly hardMs: number,
    private readonly maxEntries = 500,
  ) {}

  get(key: string): CacheHit<T> | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (now > entry.hardUntil) {
      this.store.delete(key);
      return null;
    }
    // Refresh recency.
    this.store.delete(key);
    this.store.set(key, entry);
    return { value: entry.value, stale: now > entry.freshUntil, storedAt: entry.storedAt };
  }

  /** Return an entry even if stale (used only as a last-resort fallback). */
  getStale(key: string): CacheHit<T> | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.hardUntil) {
      this.store.delete(key);
      return null;
    }
    return {
      value: entry.value,
      stale: Date.now() > entry.freshUntil,
      storedAt: entry.storedAt,
    };
  }

  set(key: string, value: T): void {
    const now = Date.now();
    this.store.delete(key);
    this.store.set(key, {
      value,
      storedAt: now,
      freshUntil: now + this.freshMs,
      hardUntil: now + this.hardMs,
    });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  clear(): void {
    this.store.clear();
  }
}
