import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { Client, Pool } from 'pg';
import { cacheBenchmark } from './cache-benchmark.js';
import { addCurrentIndexes, seedLab, seedObservations } from './fixtures.js';
import { digest, equivalent, measure } from './measure.js';
import { listQueries, liveStats, observationQuery, viewStats } from './queries.js';
import { labUrls } from './safety.js';
import { renderReport } from './report.js';

type Options = { rows: number; repetitions: number; requests: number; concurrency: number };
const MARKER = 'Outbox synthetic performance lab v1';
async function ensureDatabase(url: string) {
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new Client({
    connectionString: adminUrl.href,
    connectionTimeoutMillis: 3000,
    application_name: 'outbox-performance-bootstrap',
  });
  await admin.connect();
  try {
    await admin.query(`SELECT pg_advisory_lock(20871362)`);
    const existing = await admin.query<{ marker: string | null }>(
      `SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = 'outbox_performance_lab'`,
    );
    if (!existing.rowCount) {
      await admin.query('CREATE DATABASE outbox_performance_lab');
      await admin.query(`COMMENT ON DATABASE outbox_performance_lab IS '${MARKER}'`);
    } else if (existing.rows[0].marker !== MARKER) {
      throw new Error('同名数据库并非本实验创建，已停止；不会清空或覆盖它。');
    }
  } finally {
    await admin.end();
  }
}

export async function runPerformance(options: Options, progress: (message: string) => void) {
  const urls = labUrls();
  const schema = `perf_${randomBytes(8).toString('hex')}`;
  await ensureDatabase(urls.postgres);
  const db = new Client({
    connectionString: urls.postgres,
    connectionTimeoutMillis: 3000,
    statement_timeout: 90_000,
    application_name: 'outbox-performance',
  });
  const pool = new Pool({
    connectionString: urls.postgres,
    max: options.concurrency,
    connectionTimeoutMillis: 3000,
    statement_timeout: 90_000,
    application_name: 'outbox-performance-cache',
    options: `-c search_path=${schema}`,
  });
  await db.connect();
  const startedAt = new Date().toISOString();
  let report: BenchmarkReport | undefined;
  try {
    const metadata =
      await db.query(`SELECT version() AS postgres_version, current_setting('shared_buffers') AS shared_buffers,
      current_setting('work_mem') AS work_mem, current_setting('jit') AS jit,
      current_setting('max_parallel_workers_per_gather') AS parallel_workers_per_gather`);
    progress(`准备独立合成数据：${options.rows} 条岗位、200 家虚构公司。`);
    await seedLab(db, schema, options.rows);
    const actual = (
      await db.query<{ jobs: number; boards: number }>(
        `SELECT (SELECT count(*)::int FROM "Job") jobs, (SELECT count(*)::int FROM "Board") boards`,
      )
    ).rows[0];
    const size = async () =>
      Number(
        (await db.query<{ bytes: string }>(`SELECT pg_total_relation_size('"Job"')::text AS bytes`)).rows[0]
          .bytes,
      );
    const baselineBytes = await size();
    const baseline = [];
    progress('测量仅有主键和唯一约束时的查询。');
    for (const query of listQueries) baseline.push(await measure(db, query, options.repetitions));
    progress('添加当前岗位库已有的索引，再运行同一组查询。');
    let start = performance.now();
    await addCurrentIndexes(db);
    const indexBuildMs = performance.now() - start,
      indexedBytes = await size();
    const indexed = [];
    for (let index = 0; index < listQueries.length; index++) {
      const result = await measure(db, listQueries[index], options.repetitions);
      equivalent(baseline[index], result);
      indexed.push(result);
    }
    progress('测量公司统计聚合与物化视图，验证刷新前后的差异。');
    const aggregate = await measure(db, liveStats, options.repetitions);
    start = performance.now();
    await db.query(`CREATE MATERIALIZED VIEW board_stats AS SELECT b.id AS board_id,
      count(j.id)::int AS total_jobs, count(j.id) FILTER (WHERE j.active)::int AS active_jobs,
      count(j.id) FILTER (WHERE j.active AND j.remote)::int AS remote_jobs
      FROM "Board" b LEFT JOIN "Job" j ON j."boardId" = b.id GROUP BY b.id;
      CREATE UNIQUE INDEX board_stats_key ON board_stats(board_id);`);
    const viewBuildMs = performance.now() - start;
    const materialized = await measure(db, viewStats, options.repetitions);
    equivalent(aggregate, materialized);
    const target = (
      await db.query<{ id: string }>(
        `SELECT j.id FROM "Job" j JOIN "Board" b ON b.id = j."boardId" WHERE j.active AND b.enabled LIMIT 1`,
      )
    ).rows[0].id;
    await db.query(`UPDATE "Job" SET active = false WHERE id = $1`, [target]);
    const staleHash = digest((await db.query(viewStats.text)).rows);
    const currentHash = digest((await db.query(liveStats.text)).rows);
    if (staleHash === currentHash) throw new Error('Expected a stale materialized snapshot after a write.');
    start = performance.now();
    await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY board_stats');
    const refreshMs = performance.now() - start;
    if (digest((await db.query(viewStats.text)).rows) !== currentHash)
      throw new Error('Materialized refresh mismatch.');
    await db.query(`UPDATE "Job" SET active = true WHERE id = $1`, [target]);
    await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY board_stats');
    progress(`比较普通表与 12 个月分区：${options.rows * 6} 条合成历史记录，两边使用相同索引。`);
    await seedObservations(db, options.rows);
    const partitions = [];
    for (const bounded of [true, false]) {
      const flat = await measure(db, observationQuery(false, bounded), options.repetitions);
      const partitioned = await measure(db, observationQuery(true, bounded), options.repetitions);
      equivalent(flat, partitioned);
      partitions.push({ range: bounded ? 'one-month' : 'all-history', flat, partitioned });
    }
    progress('比较直接读库、Redis 冷缓存和热缓存，并验证过期、版本失效及故障回退。');
    const cache = await cacheBenchmark(pool, urls.redis, schema, options.requests, options.concurrency);
    report = {
      version: 1,
      startedAt,
      completedAt: new Date().toISOString(),
      schema,
      data: { ...actual, observationsPerLayout: options.rows * 6, synthetic: true },
      options,
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model ?? 'unknown',
        logicalCpus: cpus().length,
        hostMemoryBytes: totalmem(),
        ...metadata.rows[0],
        redis: cache.version,
      },
      indexes: { baseline, indexed, indexBuildMs, baselineBytes, indexedBytes },
      materializedView: {
        aggregate,
        materialized,
        viewBuildMs,
        refreshMs,
        staleBeforeRefresh: true,
        equalAfterRefresh: true,
      },
      partitions,
      cache,
      cleanedUp: false,
    };
  } finally {
    await pool.end();
    try {
      await db.query('SET search_path TO public');
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      if (report) report.cleanedUp = true;
    } finally {
      await db.end();
    }
  }
  if (!report) throw new Error('No benchmark report generated.');
  const folder = resolve('performance/results', startedAt.replace(/[:.]/g, '-') + '-' + schema.slice(-8));
  await mkdir(folder, { recursive: true });
  await writeFile(resolve(folder, 'results.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  await writeFile(resolve(folder, 'REPORT.md'), renderReport(report), { flag: 'wx' });
  return { folder, report };
}
export type BenchmarkReport = {
  version: number;
  startedAt: string;
  completedAt: string;
  schema: string;
  data: { jobs: number; boards: number; observationsPerLayout: number; synthetic: boolean };
  options: Options;
  environment: Record<string, unknown>;
  indexes: {
    baseline: Awaited<ReturnType<typeof measure>>[];
    indexed: Awaited<ReturnType<typeof measure>>[];
    indexBuildMs: number;
    baselineBytes: number;
    indexedBytes: number;
  };
  materializedView: {
    aggregate: Awaited<ReturnType<typeof measure>>;
    materialized: Awaited<ReturnType<typeof measure>>;
    viewBuildMs: number;
    refreshMs: number;
    staleBeforeRefresh: boolean;
    equalAfterRefresh: boolean;
  };
  partitions: {
    range: string;
    flat: Awaited<ReturnType<typeof measure>>;
    partitioned: Awaited<ReturnType<typeof measure>>;
  }[];
  cache: Awaited<ReturnType<typeof cacheBenchmark>>;
  cleanedUp: boolean;
};
