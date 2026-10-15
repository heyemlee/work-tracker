/** Benchmarks may only use the dedicated local lab database and Redis instance. Never inherit DATABASE_URL. */
export function labUrls(env: NodeJS.ProcessEnv = process.env) {
  const postgres = new URL(
    env.PERF_DATABASE_URL ?? 'postgresql://outbox:outbox@127.0.0.1:55432/outbox_performance_lab',
  );
  const redis = new URL(env.PERF_REDIS_URL ?? 'redis://127.0.0.1:56380/0');
  const local = (url: URL) => ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (
    !['postgres:', 'postgresql:'].includes(postgres.protocol) ||
    !local(postgres) ||
    postgres.port !== '55432' ||
    postgres.pathname !== '/outbox_performance_lab' ||
    postgres.search ||
    postgres.hash
  )
    throw new Error('性能实验只允许本机 55432 端口的 outbox_performance_lab 数据库。');
  if (
    redis.protocol !== 'redis:' ||
    !local(redis) ||
    redis.port !== '56380' ||
    !['', '/', '/0'].includes(redis.pathname) ||
    redis.search ||
    redis.hash
  )
    throw new Error('性能实验只允许本机 56380 端口的专用 Redis。');
  return { postgres: postgres.href, redis: redis.href };
}
export function schemaName(value: string) {
  if (!/^perf_[a-f0-9]{16}$/.test(value)) throw new Error('Invalid lab schema name.');
  return value;
}
export function percentile(values: number[], fraction: number) {
  if (!values.length || fraction < 0 || fraction > 1) throw new Error('Invalid percentile input.');
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)];
}
export function timings(values: number[]) {
  return {
    samplesMs: values,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
  };
}
