import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins/bearer';
import type { Db } from './db';
import * as authSchema from './db/auth-schema';

/** OWNER_EMAILS is a comma-separated allowlist. Anyone else is turned away at sign-up. */
export function allowedEmails(env: Env): string[] {
  return env.OWNER_EMAILS.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function createAuth(env: Env, db: Db) {
  const allowed = allowedEmails(env);
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL || undefined,
    secret: env.BETTER_AUTH_SECRET,
    // Failed sign-ins land back on the app's own sign-in screen (with ?error=) instead of Better Auth's page.
    onAPIError: env.BETTER_AUTH_URL ? { errorURL: `${env.BETTER_AUTH_URL}/` } : undefined,
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    // A session read from the database rides along in a signed cookie for five minutes, and requests in that time are
    // checked against the cookie alone: the lookup is two queries, on every request. A session ended somewhere else
    // keeps working in this browser for those minutes at most.
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    socialProviders: env.GOOGLE_CLIENT_ID
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: 'select_account',
          },
        }
      : undefined,
    // The Autofill extension sends the session token as a bearer token when Chrome won't attach the cookie to its
    // requests; the token is the one the cookie carries, read by the extension from /api/auth/get-session.
    plugins: [bearer()],
    databaseHooks: {
      user: {
        create: {
          // Returning false aborts creating the user, so only allowlisted accounts ever exist.
          before: async (user) => (allowed.includes(user.email.toLowerCase()) ? undefined : false),
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
