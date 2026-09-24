import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { ConflictError, NotFoundError } from '../src/domain/errors';
import type { Repository } from '../src/domain/repository';
import { createAuth, type Auth } from './auth';
import { createDb, type Db } from './db';
import { user as users } from './db/auth-schema';
import { createDemoSandbox, DEMO_TTL_MS, isDemoUserId } from './demo';
import { createD1Repository } from './repository';
import * as body from './validation';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  demo: boolean;
}

/** Requests to DEMO_HOST run the public demo against DEMO_DB; every other host is the owner's app on DB. */
type Mode = 'owner' | 'demo';

type AppEnv = {
  Bindings: Env;
  Variables: { mode: Mode; db: Db; user: SessionUser; repo: Repository };
};

const DEMO_COOKIE = 'outbox_demo';
const DEV_USER: SessionUser = {
  id: 'dev-user',
  name: 'Developer',
  email: 'dev@outbox.local',
  image: null,
  demo: false,
};

// Database handles and the auth instance are built once per isolate: building Better Auth wastes CPU.
const services = new WeakMap<Env, { db?: Db; demoDb?: Db; auth?: Auth }>();

function servicesFor(env: Env) {
  let entry = services.get(env);
  if (!entry) {
    entry = {};
    services.set(env, entry);
  }
  return entry;
}

function dbFor(env: Env, mode: Mode): Db {
  const entry = servicesFor(env);
  return mode === 'demo' ? (entry.demoDb ??= createDb(env.DEMO_DB)) : (entry.db ??= createDb(env.DB));
}

/** Better Auth only ever serves the owner's app, on the owner's database. */
function authFor(env: Env): Auth {
  const entry = servicesFor(env);
  return (entry.auth ??= createAuth(env, dbFor(env, 'owner')));
}

function isLocalhost(url: string): boolean {
  const { hostname } = new URL(url);
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/** Local development without Google: act as a fixed developer account. Only honored with DEV_AUTH_BYPASS=true. */
async function devUser(db: Db): Promise<SessionUser> {
  await db
    .insert(users)
    .values({ id: DEV_USER.id, name: DEV_USER.name, email: DEV_USER.email, emailVerified: true })
    .onConflictDoNothing();
  return DEV_USER;
}

/** The demo's address as seen from this request, for the sign-in screen's "Try the demo" link. */
function demoUrl(c: Context<AppEnv>): string | undefined {
  if (!c.env.DEMO_HOST) return undefined;
  const url = new URL(c.req.url);
  url.hostname = c.env.DEMO_HOST;
  url.pathname = '/';
  url.search = '';
  return url.toString();
}

/** The visitor's sandbox, from a signed cookie; undefined once the cron has purged it. */
async function demoUser(c: Context<AppEnv>): Promise<SessionUser | undefined> {
  const id = await getSignedCookie(c, c.env.BETTER_AUTH_SECRET, DEMO_COOKIE);
  if (!id || !isDemoUserId(id)) return undefined;
  const row = await c.var.db.select({ id: users.id }).from(users).where(eq(users.id, id)).get();
  return row ? { id, name: 'Demo visitor', email: '', image: null, demo: true } : undefined;
}

const withMode = createMiddleware<AppEnv>(async (c, next) => {
  const mode: Mode = c.env.DEMO_HOST && new URL(c.req.url).hostname === c.env.DEMO_HOST ? 'demo' : 'owner';
  c.set('mode', mode);
  c.set('db', dbFor(c.env, mode));
  await next();
});

const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  let user: SessionUser | undefined;
  if (c.var.mode === 'demo') {
    user = await demoUser(c);
    // `demo: true` tells the app to start a sandbox rather than show the sign-in screen.
    if (!user) return c.json({ error: 'No demo session', demo: true }, 401);
  } else if (c.env.DEV_AUTH_BYPASS === 'true' && isLocalhost(c.req.url)) {
    // Defense in depth: the bypass lives only in .dev.vars, and even then only works on localhost.
    user = await devUser(c.var.db);
  } else {
    const session = await authFor(c.env).api.getSession({ headers: c.req.raw.headers });
    if (session) {
      const { id, name, email, image } = session.user;
      user = { id, name, email, image: image ?? null, demo: false };
    }
  }
  if (!user) return c.json({ error: 'Not signed in', demoUrl: demoUrl(c) }, 401);
  c.set('user', user);
  c.set('repo', createD1Repository(c.var.db, user.id));
  await next();
});

const demoOnly = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.mode !== 'demo') return c.json({ error: 'Not found' }, 404);
  await next();
});

const noContent = 204;

const api = new Hono<AppEnv>()
  .use(requireUser)
  .get('/me', (c) => c.json({ user: c.var.user }))
  .get('/snapshot', async (c) => c.json(await c.var.repo.load()))
  .get('/jobs/:id/events', async (c) => c.json(await c.var.repo.loadEvents(c.req.param('id'))))

  .post('/quick-add', zValidator('json', body.quickAdd), async (c) =>
    c.json(await c.var.repo.quickAdd(c.req.valid('json')), 201),
  )
  .post('/quick-add/undo', zValidator('json', body.quickAddResult), async (c) => {
    await c.var.repo.undoQuickAdd(c.req.valid('json'));
    return c.body(null, noContent);
  })

  .post('/applications', zValidator('json', body.newApplication), async (c) =>
    c.json({ id: await c.var.repo.addApplication(c.req.valid('json')) }, 201),
  )
  .patch('/applications/:id', zValidator('json', body.applicationPatch), async (c) => {
    const id = c.req.param('id');
    const { stage, rejected, ...fields } = c.req.valid('json');
    // Stage and rejection go through their commands so the timeline records them.
    if (stage !== undefined) await c.var.repo.setStage(id, stage);
    if (rejected !== undefined) await c.var.repo.setRejected(id, rejected);
    if (Object.values(fields).some((value) => value !== undefined))
      await c.var.repo.updateApplication(id, fields);
    return c.body(null, noContent);
  })
  .delete('/applications/:id', async (c) => {
    await c.var.repo.removeApplication(c.req.param('id'));
    return c.body(null, noContent);
  })

  .patch('/jobs/:id', zValidator('json', body.jobPatch), async (c) => {
    await c.var.repo.updateJob(c.req.param('id'), c.req.valid('json'));
    return c.body(null, noContent);
  })
  .delete('/jobs/:id', async (c) => {
    await c.var.repo.deleteJob(c.req.param('id'));
    return c.body(null, noContent);
  })
  .post('/jobs/:id/restore', async (c) => {
    await c.var.repo.restoreJob(c.req.param('id'));
    return c.body(null, noContent);
  })

  .post('/accounts', zValidator('json', body.account), async (c) =>
    c.json({ id: await c.var.repo.saveAccount(c.req.valid('json')) }, 201),
  )
  .patch('/accounts/:id', zValidator('json', body.account), async (c) => {
    await c.var.repo.saveAccount({ ...c.req.valid('json'), id: c.req.param('id') });
    return c.body(null, noContent);
  })
  .delete('/accounts/:id', async (c) => {
    await c.var.repo.deleteAccount(c.req.param('id'));
    return c.body(null, noContent);
  })

  .post('/resumes', zValidator('json', body.named), async (c) =>
    c.json({ id: await c.var.repo.saveResume(c.req.valid('json')) }, 201),
  )
  .patch('/resumes/:id', zValidator('json', body.named), async (c) => {
    await c.var.repo.saveResume({ ...c.req.valid('json'), id: c.req.param('id') });
    return c.body(null, noContent);
  })
  .delete('/resumes/:id', async (c) => {
    await c.var.repo.deleteResume(c.req.param('id'));
    return c.body(null, noContent);
  })

  .post('/channels', zValidator('json', body.named), async (c) =>
    c.json({ id: await c.var.repo.saveChannel(c.req.valid('json')) }, 201),
  )
  .patch('/channels/:id', zValidator('json', body.named), async (c) => {
    await c.var.repo.saveChannel({ ...c.req.valid('json'), id: c.req.param('id') });
    return c.body(null, noContent);
  })
  .delete('/channels/:id', async (c) => {
    await c.var.repo.deleteChannel(c.req.param('id'));
    return c.body(null, noContent);
  });

export const app = new Hono<AppEnv>()
  // Rejects cross-site form posts; JSON requests from other origins are already stopped by CORS preflight.
  .use('/api/*', csrf())
  .use('/api/*', withMode)
  .on(['GET', 'POST'], '/api/auth/*', (c) =>
    c.var.mode === 'demo' ? c.json({ error: 'Not found' }, 404) : authFor(c.env).handler(c.req.raw),
  )
  // Starts a sandbox for a new visitor, or a fresh one for a reset; the old one is left for the cron to purge.
  .post('/api/demo/session', demoOnly, async (c) => {
    const { success } = await c.env.DEMO_LIMITER.limit({ key: c.req.header('cf-connecting-ip') ?? 'local' });
    if (!success) return c.json({ error: 'Too many demo sessions. Try again in a minute.' }, 429);
    const started = await createDemoSandbox(c.var.db);
    if (!started.ok) return c.json({ error: 'The demo is busy. Try again later.' }, 503);
    await setSignedCookie(c, DEMO_COOKIE, started.userId, c.env.BETTER_AUTH_SECRET, {
      httpOnly: true,
      secure: new URL(c.req.url).protocol === 'https:',
      sameSite: 'Lax',
      path: '/',
      maxAge: DEMO_TTL_MS / 1000,
    });
    return c.body(null, noContent);
  })
  .route('/api', api)
  .notFound((c) => c.json({ error: 'Not found' }, 404))
  .onError((error, c) => {
    if (error instanceof NotFoundError) return c.json({ error: error.message }, 404);
    if (error instanceof ConflictError) return c.json({ error: error.message }, 409);
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    return c.json({ error: 'Something went wrong' }, 500);
  });
