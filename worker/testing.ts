import { getPlatformProxy } from 'wrangler';
import { createDb, type Db } from './db';

// The real migrations, applied to an in-memory D1 that workerd runs for the test.
const migrations = import.meta.glob<string>('../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * A fresh in-memory D1 with every migration applied: through Drizzle, and as the binding the Worker is handed. Call
 * `dispose` when the tests are done.
 */
export async function startTestDatabase(): Promise<{
  db: Db;
  d1: D1Database;
  dispose: () => Promise<void>;
}> {
  const proxy = await getPlatformProxy<Env>({ persist: false });
  const d1 = proxy.env.DB;
  for (const [, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    await d1.batch(statements.map((statement) => d1.prepare(statement)));
  }
  return { db: createDb(d1), d1, dispose: () => proxy.dispose() };
}
