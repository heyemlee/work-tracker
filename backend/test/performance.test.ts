import { describe, expect, it, vi } from 'vitest';
import { cacheKey, ReadCache, type CacheContext, type CacheStore } from '../src/performance/cache.js';
import { labUrls, percentile, schemaName } from '../src/performance/safety.js';

const context: CacheContext = {
  scope: 'selected-companies-a',
  revision: 'sync-1',
  query: { q: 'engineer', page: 1 },
};
const number = (value: unknown) => {
  if (typeof value !== 'number') throw new Error('Invalid value');
  return value;
};
function memoryStore() {
  let now = 0;
  const entries = new Map<string, { value: string; until: number }>();
  const store: CacheStore = {
    async get(key) {
      const entry = entries.get(key);
      return entry && entry.until > now ? entry.value : null;
    },
    async set(key, value, ttlMs) {
      entries.set(key, { value, until: now + ttlMs });
    },
  };
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
    entries,
  };
}
describe('Performance lab isolation and measurements', () => {
  it('never inherits the application database URL', () => {
    expect(labUrls({ DATABASE_URL: 'postgres://production.example/customer' }).postgres).toContain(
      '127.0.0.1:55432/outbox_performance_lab',
    );
  });
  it.each([
    { PERF_DATABASE_URL: 'postgres://outbox:password@127.0.0.1:55432/outbox' },
    { PERF_DATABASE_URL: 'postgres://outbox:password@db.example:55432/outbox_performance_lab' },
    { PERF_DATABASE_URL: 'postgres://outbox:password@127.0.0.1:55432/outbox_performance_lab?options=other' },
    { PERF_REDIS_URL: 'redis://127.0.0.1:6379/0' },
    { PERF_REDIS_URL: 'redis://cache.example:56380/0' },
  ])('refuses a non-lab target', (env) => {
    expect(() => labUrls(env)).toThrow('性能实验');
  });
  it('only permits generated schema names for create/drop operations', () => {
    expect(schemaName('perf_0123456789abcdef')).toBe('perf_0123456789abcdef');
    for (const name of ['public', 'perf_test', 'perf_0123456789abcdef; DROP SCHEMA public'])
      expect(() => schemaName(name)).toThrow();
  });
  it('uses nearest-rank percentiles without changing the raw samples', () => {
    const samples = [9, 1, 7, 2, 8, 3, 10, 4, 11, 5, 6];
    expect(percentile(samples, 0.5)).toBe(6);
    expect(percentile(samples, 0.95)).toBe(11);
    expect(samples[0]).toBe(9);
    expect(() => percentile([], 0.5)).toThrow();
  });
});

describe('Read cache correctness', () => {
  it('keys include selection scope, dataset revision and all filters, regardless of property order', () => {
    expect(cacheKey('lab', context)).toBe(cacheKey('lab', { ...context, query: { page: 1, q: 'engineer' } }));
    for (const changed of [
      { ...context, scope: 'selected-companies-b' },
      { ...context, revision: 'sync-2' },
      { ...context, query: { q: 'engineer', page: 2 } },
    ])
      expect(cacheKey('lab', changed)).not.toBe(cacheKey('lab', context));
  });
  it('expires data and keeps two selection scopes separate', async () => {
    const memory = memoryStore(),
      cache = new ReadCache(memory.store, 'lab', number, 100);
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    expect(await cache.read(context, load)).toBe(1);
    expect(await cache.read(context, load)).toBe(1);
    expect(await cache.read({ ...context, scope: 'another-selection' }, load)).toBe(2);
    memory.advance(101);
    expect(await cache.read(context, load)).toBe(3);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it('coalesces concurrent cold reads for one key', async () => {
    const memory = memoryStore(),
      cache = new ReadCache(memory.store, 'lab', number);
    let release!: (value: number) => void;
    const wait = new Promise<number>((resolve) => {
      release = resolve;
    });
    const load = vi.fn(() => wait);
    const readers = Array.from({ length: 8 }, () => cache.read(context, load));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    release(42);
    expect(await Promise.all(readers)).toEqual(Array(8).fill(42));
    expect(cache.counts.databaseReads).toBe(1);
  });
  it('an old in-flight load cannot overwrite the new revision', async () => {
    const memory = memoryStore(),
      cache = new ReadCache(memory.store, 'lab', number);
    let release!: (value: number) => void;
    const oldLoad = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = resolve;
        }),
    );
    const oldRead = cache.read(context, oldLoad);
    await vi.waitFor(() => expect(oldLoad).toHaveBeenCalledTimes(1));
    const current = { ...context, revision: 'sync-2' };
    expect(await cache.read(current, async () => 2)).toBe(2);
    release(1);
    expect(await oldRead).toBe(1);
    const unnecessary = vi.fn(async () => 99);
    expect(await cache.read(current, unnecessary)).toBe(2);
    expect(unnecessary).not.toHaveBeenCalled();
  });
  it('falls back on network errors without losing database results', async () => {
    const unavailable: CacheStore = {
      get: async () => {
        throw new Error('network down');
      },
      set: async () => {
        throw new Error('network down');
      },
    };
    const cache = new ReadCache(unavailable, 'lab', number);
    expect(await cache.read(context, async () => 42)).toBe(42);
    expect(cache.counts.errors).toBe(2);
  });
  it.each(['not json', '"wrong type"'])('repairs a corrupt cached payload: %s', async (payload) => {
    const memory = memoryStore(),
      cache = new ReadCache(memory.store, 'lab', number);
    await memory.store.set(cacheKey('lab', context), payload, 1000);
    expect(await cache.read(context, async () => 5)).toBe(5);
    expect(await cache.read(context, async () => 6)).toBe(5);
  });
  it('does not cache database errors and permits a later recovery', async () => {
    const memory = memoryStore(),
      cache = new ReadCache(memory.store, 'lab', number);
    await expect(
      cache.read(context, async () => {
        throw new Error('database down');
      }),
    ).rejects.toThrow('database down');
    expect(await cache.read(context, async () => 7)).toBe(7);
  });
});
