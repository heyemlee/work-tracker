import { makeSignature } from 'better-auth/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './app';
import { createAuth } from './auth';
import { user } from './db/auth-schema';
import { startTestDatabase } from './testing';

let env: Env;
let dispose: () => Promise<void>;
/** Statements sent to the database so far. */
let statements = 0;
/** The owner's session cookie, as a browser signed in with Google holds it. */
let signedIn: string;
/** The name of the cookie a session read from the database is cached in. */
let cacheName: string;

beforeAll(async () => {
  const started = await startTestDatabase();
  dispose = started.dispose;
  const { d1 } = started;
  env = {
    DB: new Proxy(d1, {
      get(target, key) {
        if (key === 'prepare')
          return (query: string) => {
            statements++;
            return target.prepare(query);
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? (value.bind(target) as unknown) : value;
      },
    }),
    BETTER_AUTH_SECRET: 'a-test-secret-of-at-least-32-characters',
    BETTER_AUTH_URL: 'http://localhost:5180',
    DEV_AUTH_BYPASS: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    OWNER_EMAILS: 'owner@example.com',
  };
  await started.db
    .insert(user)
    .values({ id: 'owner', name: 'Owner', email: 'owner@example.com', emailVerified: true });
  const context = await createAuth(env, started.db).$context;
  const session = await context.internalAdapter.createSession('owner');
  const signature = await makeSignature(session.token, env.BETTER_AUTH_SECRET);
  signedIn = `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`;
  cacheName = context.authCookies.sessionData.name;
}, 30_000);

afterAll(async () => {
  await dispose?.();
});

/** Asks who's signed in, and says what it took: the answer, the statements it sent, the cookies it set. */
async function me(cookie?: string) {
  const before = statements;
  const response = await app.request('/api/me', { headers: cookie ? { cookie } : {} }, env);
  return {
    status: response.status,
    body: (await response.json()) as { user?: { email: string } },
    statements: statements - before,
    cookies: response.headers.getSetCookie(),
  };
}

describe('who a request is from', () => {
  it('turns away a request with no session, without asking the database', async () => {
    expect(await me()).toMatchObject({ status: 401, statements: 0 });
    expect(await me(`${signedIn.split('=')[0]}=made-up.signature`)).toMatchObject({
      status: 401,
      statements: 0,
    });
  });

  it('looks a session up once, then goes by the cookie it answered with', async () => {
    const first = await me(signedIn);
    expect(first).toMatchObject({ status: 200, body: { user: { email: 'owner@example.com' } } });
    // The session and its user.
    expect(first.statements).toBe(2);
    const cached = first.cookies.find((cookie) => cookie.startsWith(`${cacheName}=`));
    expect(cached).toMatch(/Max-Age=300/i);

    const next = await me(`${signedIn}; ${cached?.split(';')[0]}`);
    expect(next).toMatchObject({ status: 200, body: { user: { email: 'owner@example.com' } } });
    expect(next.statements).toBe(0);
    expect(next.cookies).toEqual([]);
  });

  it('looks the session up again once the cookie is gone', async () => {
    expect(await me(signedIn)).toMatchObject({ status: 200, statements: 2 });
  });
});
