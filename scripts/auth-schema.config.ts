// Used only by `npm run auth:schema`, which asks the Better Auth CLI to write worker/db/auth-schema.ts.
// The real configuration is built per request in worker/auth.ts; keep the plugin list here in step with it.
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';

export const auth = betterAuth({
  database: drizzleAdapter({} as never, { provider: 'sqlite' }),
  socialProviders: { google: { clientId: 'unused', clientSecret: 'unused' } },
});
