import type { Pool } from 'pg';
import { createClient } from 'redis';
import { z } from 'zod';
import { cacheKey, ReadCache, type CacheContext, type CacheStore } from './cache.js';
import { digest } from './measure.js';
import { listQueries } from './queries.js';
import { timings, schemaName } from './safety.js';

const rowsSchema = z.array(
  z.strictObject({
    id: z.string(),
    title: z.string(),
    company: z.string(),
    location: z.string(),
    department: z.string(),
    url: z.string(),
    remote: z.boolean(),
    active: z.boolean(),
    provider: z.string(),
    publishedAt: z.string().nullable(),
    seenAt: z.string(),
  }),
);

export async function cacheBenchmark(
  pool: Pool,
  redisUrl: string,
  schema: string,
  requests: number,
  concurrency: number,
) {
  schemaName(schema);
  const redis = createClient({
    url: redisUrl,
    socket: { reconnectStrategy: false, connectTimeout: 2000 },
    disableOfflineQueue: true,
  });
  // Errors are reflected by cache fallback and counts; never log connection strings or result data.
  redis.on('error', () => {});
  const namespace = `outbox-perf:${schema}`;
  const touched = new Set<string>();
  const store: CacheStore = {
    get: (key) => redis.get(key),
    async set(key, value, ttlMs) {
      touched.add(key);
      await redis.set(key, value, { PX: ttlMs });
    },
  };
  let databaseReads = 0;
  async function load(index: number) {
    const client = await pool.connect();
    try {
      const query = listQueries[index];
      databaseReads++;
      const rows = (await client.query(query.text, query.values)).rows;
      return rowsSchema.parse(JSON.parse(JSON.stringify(rows)));
    } finally {
      client.release();
    }
  }
  const context = (index: number, revision = 'dataset-v1'): CacheContext => ({
    scope: 'local-selected-companies',
    revision,
    query: { name: listQueries[index].name, page: 1, limit: 51 },
  });
  const expected = await Promise.all(listQueries.map((_, index) => load(index).then(digest)));
  async function batch(read: (index: number) => Promise<unknown>) {
    let next = 0;
    const start = performance.now(),
      samples: number[] = [];
    const readsBefore = databaseReads;
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        for (;;) {
          const index = next++;
          if (index >= requests) return;
          const queryIndex = index % listQueries.length,
            began = performance.now();
          const rows = await read(queryIndex);
          samples.push(performance.now() - began);
          if (digest(rows) !== expected[queryIndex])
            throw new Error('Cached query returned a different result.');
        }
      }),
    );
    return {
      requests,
      concurrency,
      wallMs: performance.now() - start,
      databaseReads: databaseReads - readsBefore,
      latency: timings(samples),
    };
  }
  try {
    await redis.connect();
    const version = (await redis.info('server')).match(/redis_version:([^\r\n]+)/)?.[1] ?? 'unknown';
    const cache = new ReadCache(store, namespace, (value) => rowsSchema.parse(value));
    // Alternate order between rounds so later rounds don't always favor the cached path.
    const rounds = [];
    const cold = await batch((index) => cache.read(context(index), () => load(index)));
    for (let round = 0; round < 3; round++) {
      if (round % 2 === 0) {
        const uncached = await batch(load);
        const warm = await batch((index) => cache.read(context(index), () => load(index)));
        rounds.push({ uncached, warm });
      } else {
        const warm = await batch((index) => cache.read(context(index), () => load(index)));
        const uncached = await batch(load);
        rounds.push({ uncached, warm });
      }
    }
    // Real Redis expiry and version invalidation; the fake fixture changes are confined to this key's payload.
    const probe = new ReadCache(store, namespace + ':probe', (value) => z.number().parse(value), 500);
    let source = 1,
      probeReads = 0;
    const probeContext: CacheContext = { scope: 'selection-a', revision: '1', query: { name: 'ttl-check' } };
    const readSource = async () => {
      probeReads++;
      return source;
    };
    const first = await probe.read(probeContext, readSource);
    const expiryMs = await redis.pTTL(cacheKey(namespace + ':probe', probeContext));
    source = 2;
    const cached = await probe.read(probeContext, readSource);
    await new Promise((resolve) => setTimeout(resolve, 650));
    const afterExpiry = await probe.read(probeContext, readSource);
    source = 3;
    const afterRevision = await probe.read({ ...probeContext, revision: '2' }, readSource);
    if (first !== 1 || cached !== 1 || afterExpiry !== 2 || afterRevision !== 3 || probeReads !== 3)
      throw new Error('Cache expiry or revision check failed.');
    const keys = [...touched];
    if (keys.length) await redis.del(keys);
    touched.clear();
    await redis.quit();
    // A disconnected Redis client must preserve availability by querying PostgreSQL.
    const outageCache = new ReadCache(store, namespace, (value) => rowsSchema.parse(value));
    const outageReadsBefore = databaseReads;
    const outageRows = await outageCache.read(context(0), () => load(0));
    if (digest(outageRows) !== expected[0] || databaseReads - outageReadsBefore !== 1)
      throw new Error('Redis outage did not fall back to PostgreSQL.');
    return {
      version,
      cold,
      rounds,
      counts: cache.counts,
      checks: {
        resultsEqual: true,
        ttlExpiry: true,
        ttlObservedMs: expiryMs,
        revisionInvalidation: true,
        disconnectedFallback: true,
      },
    };
  } finally {
    if (redis.isReady && touched.size) await redis.del([...touched]);
    if (redis.isOpen) redis.destroy();
  }
}
export type CacheBenchmark = Awaited<ReturnType<typeof cacheBenchmark>>;
