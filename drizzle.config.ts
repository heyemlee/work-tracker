import { defineConfig } from 'drizzle-kit';

// drizzle-kit only generates the SQL; wrangler applies it (`npm run db:migrate:local` / `db:migrate:remote`).
export default defineConfig({
  dialect: 'sqlite',
  schema: ['./worker/db/auth-schema.ts', './worker/db/schema.ts'],
  out: './migrations',
});
