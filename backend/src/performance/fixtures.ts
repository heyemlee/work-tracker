import type { Client } from 'pg';
import { schemaName } from './safety.js';

export async function seedLab(db: Client, schema: string, rows: number) {
  schemaName(schema);
  await db.query(`CREATE SCHEMA "${schema}"`);
  await db.query(`SET search_path TO "${schema}"`);
  await db.query(`
    CREATE TABLE "Board" (id uuid PRIMARY KEY, provider text NOT NULL, slug text NOT NULL, company text NOT NULL, enabled boolean NOT NULL, UNIQUE(provider, slug));
    CREATE TABLE "Job" (
      id uuid PRIMARY KEY, "boardId" uuid NOT NULL REFERENCES "Board"(id), "externalId" text NOT NULL,
      title text NOT NULL, company text NOT NULL, location text NOT NULL, department text NOT NULL,
      description text NOT NULL, url text NOT NULL, remote boolean NOT NULL, active boolean NOT NULL,
      "publishedAt" timestamptz, "seenAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
      UNIQUE("boardId", "externalId")
    );
    INSERT INTO "Board"
      SELECT md5('board-' || n)::uuid, 'synthetic', 'company-' || n, 'Example Company ' || n, n % 5 = 0
      FROM generate_series(1, 200) n;
  `);
  // Multipliers are coprime with the board/date divisors, to avoid accidentally making selected companies all inactive.
  await db.query(
    `INSERT INTO "Job"
    SELECT md5('job-' || n)::uuid, md5('board-' || ((n * 37) % 200 + 1))::uuid, n::text,
      CASE WHEN n % 97 = 0 THEN 'Kubernetes Platform Engineer' ELSE 'Software Engineer ' || (n % 5) END,
      'Example Company ' || ((n * 37) % 200 + 1),
      CASE WHEN n % 3 = 0 THEN 'Seattle, WA' WHEN n % 3 = 1 THEN 'San Francisco, CA' ELSE 'New York, NY' END,
      'Engineering', 'Build reliable TypeScript services and PostgreSQL APIs. ' || CASE WHEN n % 97 = 0 THEN 'Kubernetes infrastructure.' ELSE 'Product development and testing.' END,
      'https://example.invalid/jobs/' || n, n % 3 = 0, n % 7 <> 0,
      CASE WHEN n % 23 = 0 THEN NULL ELSE '2026-10-01'::timestamptz - ((n * 13) % 365) * interval '1 day' - (n % 1440) * interval '1 minute' END,
      '2026-10-01'::timestamptz, '2026-10-01'::timestamptz
    FROM generate_series(1, $1::integer) n`,
    [rows],
  );
  await db.query(`VACUUM (ANALYZE) "Job"`);
  await db.query(`ANALYZE "Board"`);
}

/** The same performance indexes that already exist in the local aggregation module. */
export async function addCurrentIndexes(db: Client) {
  await db.query(`
    CREATE INDEX "Job_active_publishedAt_id_idx" ON "Job" (active, "publishedAt" DESC, id);
    CREATE INDEX "Job_company_active_idx" ON "Job" (company, active);
    CREATE INDEX job_search_idx ON "Job" USING GIN (to_tsvector('english', title || ' ' || company || ' ' || location || ' ' || description));
    CREATE INDEX job_active_order_idx ON "Job" ("publishedAt" DESC NULLS LAST, id DESC) WHERE active;
    ANALYZE "Job";
  `);
}

export async function seedObservations(db: Client, rows: number) {
  await db.query(`
    CREATE TABLE observations_flat (job_id uuid NOT NULL, board_id uuid NOT NULL, observed_at timestamptz NOT NULL, PRIMARY KEY(job_id, observed_at));
    CREATE TABLE observations_partitioned (LIKE observations_flat INCLUDING DEFAULTS INCLUDING CONSTRAINTS) PARTITION BY RANGE(observed_at);
    ALTER TABLE observations_partitioned ADD PRIMARY KEY(job_id, observed_at);
  `);
  for (let month = 0; month < 12; month++) {
    const start = new Date(Date.UTC(2025, 9 + month, 1)).toISOString();
    const end = new Date(Date.UTC(2025, 10 + month, 1)).toISOString();
    // Dates and partition names are generated here, never supplied by the caller.
    await db.query(
      `CREATE TABLE observations_m${month} PARTITION OF observations_partitioned FOR VALUES FROM ('${start}') TO ('${end}')`,
    );
  }
  await db.query(
    `INSERT INTO observations_flat
    SELECT md5('job-' || ((n - 1) % $1::integer + 1))::uuid,
      md5('board-' || (((n - 1) % $1::integer + 1) * 37 % 200 + 1))::uuid,
      '2025-10-01'::timestamptz + ((n * 17) % 365) * interval '1 day' + (n / 365) * interval '1 second'
    FROM generate_series(1, $1::integer * 6) n`,
    [rows],
  );
  await db.query('INSERT INTO observations_partitioned SELECT * FROM observations_flat');
  // Give BOTH layouts identical time-leading indexes; a deliberately unindexed comparison would be misleading.
  await db.query(`CREATE INDEX flat_time ON observations_flat (observed_at, board_id);
    CREATE INDEX partitioned_time ON observations_partitioned (observed_at, board_id);`);
  await db.query('VACUUM (ANALYZE) observations_flat');
  for (let month = 0; month < 12; month++) await db.query(`VACUUM (ANALYZE) observations_m${month}`);
  await db.query('ANALYZE observations_partitioned');
}
