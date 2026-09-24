import { drizzle } from 'drizzle-orm/d1';
import * as authSchema from './auth-schema';
import * as appSchema from './schema';

export const schema = { ...authSchema, ...appSchema };

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
