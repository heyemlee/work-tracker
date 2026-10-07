import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { ConflictError, NotFoundError } from '../src/domain/errors';
import { profileSchema } from '../src/domain/profile';
import type { Repository } from '../src/domain/repository';
import { base64ToBytes, resumeUploadSchema } from '../src/domain/resumes';
import { createAuth, type Auth } from './auth';
import { createDb, type Db } from './db';
import { user as users } from './db/auth-schema';
import { createD1Repository } from './repository';
import * as body from './validation';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

type AppEnv = {
  Bindings: Env;
  Variables: { db: Db; auth: Auth; user: SessionUser; repo: Repository };
};

const DEV_USER: SessionUser = { id: 'dev-user', name: 'Developer', email: 'dev@outbox.local', image: null };

/** Local development without Google: act as a fixed developer account. Only honored with DEV_AUTH_BYPASS=true. */
async function devUser(db: Db): Promise<SessionUser> {
  await db
    .insert(users)
    .values({ ...DEV_USER, emailVerified: true })
    .onConflictDoNothing();
  return DEV_USER;
}

function isLocalhost(url: string): boolean {
  const { hostname } = new URL(url);
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

// One database handle and auth instance per isolate: building Better Auth on every request wastes CPU.
const services = new WeakMap<Env, { db: Db; auth: Auth }>();

const withServices = createMiddleware<AppEnv>(async (c, next) => {
  let entry = services.get(c.env);
  if (!entry) {
    const db = createDb(c.env.DB);
    entry = { db, auth: createAuth(c.env, db) };
    services.set(c.env, entry);
  }
  c.set('db', entry.db);
  c.set('auth', entry.auth);
  await next();
});

const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  let user: SessionUser | undefined;
  // Defense in depth: the bypass lives only in .dev.vars, and even then only works when served from localhost.
  if (c.env.DEV_AUTH_BYPASS === 'true' && isLocalhost(c.req.url)) {
    user = await devUser(c.var.db);
  } else {
    const { headers, response: session } = await c.var.auth.api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    // What Better Auth sets while it looks: the session it just read, as the cookie that spares the next requests
    // the lookup (auth.ts), or a cookie it found out of date, taken back.
    for (const cookie of headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true });
    if (session) {
      const { id, name, email, image } = session.user;
      user = { id, name, email, image: image ?? null };
    }
  }
  if (!user) return c.json({ error: 'Not signed in' }, 401);
  c.set('user', user);
  c.set('repo', createD1Repository(c.var.db, user.id));
  await next();
});

const noContent = 204;

/** Shown in the browser, saved under its own name: RFC 5987's `filename*`, which `encodeURIComponent` nearly is. */
function inlineFile(name: string): string {
  const escape = (char: string) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
  return `inline; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, escape)}`;
}

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
  .put('/resumes/:id/file', zValidator('json', resumeUploadSchema), async (c) =>
    c.json(await c.var.repo.saveResumeFile(c.req.param('id'), c.req.valid('json'))),
  )
  // The PDF itself, so a plain link opens it in the browser's viewer.
  .get('/resumes/:id/file', async (c) => {
    const id = c.req.param('id');
    const file = await c.var.repo.loadResumeFile(id);
    if (!file) throw new NotFoundError('Resume file', id);
    return c.body(base64ToBytes(file.data), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': inlineFile(file.name),
      // A replaced PDF keeps its address.
      'Cache-Control': 'private, no-cache',
    });
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
  })

  .get('/profile', async (c) => c.json({ saved: await c.var.repo.loadProfile() }))
  .put('/profile', zValidator('json', profileSchema), async (c) =>
    c.json(await c.var.repo.saveProfile(c.req.valid('json'))),
  );

export const app = new Hono<AppEnv>()
  // Rejects cross-site form posts; JSON requests from other origins are already stopped by CORS preflight.
  .use('/api/*', csrf())
  .use('/api/*', withServices)
  .on(['GET', 'POST'], '/api/auth/*', (c) => c.var.auth.handler(c.req.raw))
  .route('/api', api)
  .notFound((c) => c.json({ error: 'Not found' }, 404))
  .onError((error, c) => {
    if (error instanceof NotFoundError) return c.json({ error: error.message }, 404);
    if (error instanceof ConflictError) return c.json({ error: error.message }, 409);
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    return c.json({ error: 'Something went wrong' }, 500);
  });
