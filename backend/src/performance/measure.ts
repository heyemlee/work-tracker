import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import type { LabQuery } from './queries.js';
import { timings } from './safety.js';

export type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Loops'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  'Subplans Removed'?: number;
  Plans?: PlanNode[];
};
type Explain = { Plan: PlanNode; 'Planning Time': number; 'Execution Time': number };
export function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function planNodes(plan: PlanNode): PlanNode[] {
  return [plan, ...(plan.Plans ?? []).flatMap(planNodes)];
}
export async function measure(db: Client, query: LabQuery, repetitions: number) {
  const read = async () => (await db.query(query.text, query.values)).rows;
  const expected = await read();
  if (!expected.length) throw new Error(`Benchmark query returned no rows: ${query.name}`);
  await read();
  const samples: number[] = [];
  const expectedHash = digest(expected);
  for (let index = 0; index < repetitions; index++) {
    const start = performance.now();
    const rows = await read();
    samples.push(performance.now() - start);
    if (digest(rows) !== expectedHash) throw new Error(`Unstable result: ${query.name}`);
  }
  const result = await db.query<{ 'QUERY PLAN': Explain[] }>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF) ${query.text}`,
    query.values,
  );
  const explain = result.rows[0]['QUERY PLAN'][0];
  return {
    name: query.name,
    query,
    rows: expected.length,
    resultHash: expectedHash,
    client: timings(samples),
    explainExecutionMs: explain['Execution Time'],
    planningMs: explain['Planning Time'],
    sharedHitBlocks: explain.Plan['Shared Hit Blocks'] ?? 0,
    sharedReadBlocks: explain.Plan['Shared Read Blocks'] ?? 0,
    plan: explain.Plan,
  };
}
export type Measurement = Awaited<ReturnType<typeof measure>>;
export function equivalent(before: Measurement, after: Measurement) {
  if (before.resultHash !== after.resultHash)
    throw new Error(`Results differ: ${before.name} / ${after.name}`);
}
