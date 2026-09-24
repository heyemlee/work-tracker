import { getTableColumns } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db } from './index';

/** D1 binds at most 100 parameters per statement (local SQLite allows far more, so tests won't catch it). */
const MAX_BOUND_PARAMETERS = 100;

/** Multi-row insert split into statements that fit D1's parameter limit, ready for one `db.batch`. */
export function insertRows<T extends SQLiteTable>(
  db: Db,
  table: T,
  rows: T['$inferInsert'][],
): BatchItem<'sqlite'>[] {
  const perStatement = Math.max(
    1,
    Math.floor(MAX_BOUND_PARAMETERS / Object.keys(getTableColumns(table)).length),
  );
  const statements: BatchItem<'sqlite'>[] = [];
  for (let i = 0; i < rows.length; i += perStatement) {
    statements.push(db.insert(table).values(rows.slice(i, i + perStatement)));
  }
  return statements;
}
