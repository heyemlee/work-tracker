import { createHash } from 'node:crypto';

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}
export type CacheContext = {
  scope: string;
  revision: string;
  query: Record<string, string | number | boolean | null>;
};
export function cacheKey(namespace: string, context: CacheContext) {
  const ordered = Object.fromEntries(Object.entries(context.query).sort(([a], [b]) => a.localeCompare(b)));
  const hash = createHash('sha256')
    .update(JSON.stringify([context.scope, context.revision, ordered]))
    .digest('hex');
  return `${namespace}:jobs:v1:${hash}`;
}
/** Read-through cache for the experiment. Scope isolates selections; revision makes old in-flight writes unreachable. */
export class ReadCache<T> {
  readonly counts = { hits: 0, misses: 0, databaseReads: 0, coalesced: 0, errors: 0, writes: 0 };
  private pending = new Map<string, Promise<T>>();
  constructor(
    private store: CacheStore,
    private namespace: string,
    private validate: (value: unknown) => T,
    private ttlMs = 30_000,
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('Cache TTL must be a positive integer.');
  }
  async read(context: CacheContext, load: () => Promise<T>): Promise<T> {
    const key = cacheKey(this.namespace, context);
    try {
      const raw = await this.store.get(key);
      if (raw !== null) {
        const value = this.validate(JSON.parse(raw));
        this.counts.hits++;
        return value;
      }
    } catch {
      this.counts.errors++;
    }
    this.counts.misses++;
    const existing = this.pending.get(key);
    if (existing) {
      this.counts.coalesced++;
      return existing;
    }
    const work = (async () => {
      this.counts.databaseReads++;
      const value = await load();
      try {
        await this.store.set(key, JSON.stringify(value), this.ttlMs);
        this.counts.writes++;
      } catch {
        this.counts.errors++;
      }
      return value;
    })();
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }
}
