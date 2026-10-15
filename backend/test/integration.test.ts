import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Db } from '../src/db.js';
import { Aggregation } from '../src/aggregation.js';
import { Jobs } from '../src/jobs.js';
import { jobQuerySchema } from '../src/validation.js';

describe.runIf(process.env.RUN_BACKEND_INTEGRATION === '1')('Selected companies + PostgreSQL + HTTP', () => {
  const db = new Db(),
    boardId = randomUUID(),
    hiddenId = randomUUID();
  let port = 0,
    child: ChildProcess,
    jobId = '',
    logs = '';
  const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}/api/${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-outbox-local': '1', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const listing = {
    externalId: 'one',
    title: 'Compiler engineer',
    location: 'Seattle',
    department: 'Engineering',
    description: 'TypeScript compiler work',
    url: 'https://example.com/job/one',
    remote: true,
    publishedAt: null,
  };
  beforeAll(async () => {
    await db.$connect();
    await db.board.create({
      data: {
        id: boardId,
        provider: 'greenhouse',
        slug: `test-${boardId}`,
        company: 'Selected Test',
        enabled: true,
      },
    });
    await db.board.create({
      data: { id: hiddenId, provider: 'ashby', slug: `test-${hiddenId}`, company: 'Hidden Test' },
    });
    const job = await db.job.create({
      data: { ...listing, boardId, company: 'Selected Test', seenAt: new Date() },
    });
    jobId = job.id;
    await db.job.create({
      data: { ...listing, boardId: hiddenId, company: 'Hidden Test', seenAt: new Date() },
    });
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    port = typeof address === 'object' && address ? address.port : 0;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    child = fork('dist/src/main.js', [], {
      env: { ...process.env, PORT: String(port), ENABLE_SYNC: 'false' },
      silent: true,
    });
    child.stdout?.on('data', (data) => {
      logs += String(data);
    });
    child.stderr?.on('data', (data) => {
      logs += String(data);
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      ready = await fetch(`http://127.0.0.1:${port}/health`)
        .then((r) => r.ok)
        .catch(() => false);
      if (ready) break;
      if (child.exitCode !== null) throw new Error(logs);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error(`API never started: ${logs}`);
  });
  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }
    await db.board.deleteMany({ where: { id: { in: [boardId, hiddenId] } } });
    await db.$disconnect();
  });
  it('serves the separate page and validates same-origin writes and search parameters', async () => {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('关注的公司');
    expect((await request('jobs?limit=1000')).status).toBe(400);
    expect(
      (await request(`boards/${boardId}`, 'PATCH', { enabled: false }, { origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect(
      (await request(`boards/${boardId}`, 'PATCH', { enabled: false }, { 'x-outbox-local': '0' })).status,
    ).toBe(403);
    const hostStatus = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        { hostname: '127.0.0.1', port, path: '/api/jobs', headers: { host: 'evil.example' } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(hostStatus).toBe(403);
  });
  it('shows only selected companies and filters by location and remote status', async () => {
    const response = await request('jobs?q=compiler&location=seattle&remote=true');
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.items.some((job: { id: string }) => job.id === jobId)).toBe(true);
    expect(result.items.some((job: { company: string }) => job.company === 'Hidden Test')).toBe(false);
    expect((await (await request(`jobs?boardId=${boardId}&remote=false`)).json()).items).toEqual([]);
    await request(`boards/${boardId}`, 'PATCH', { enabled: false });
    expect((await (await request(`jobs?boardId=${boardId}`)).json()).items).toEqual([]);
    expect((await request(`jobs/${jobId}`)).status).toBe(404);
    expect(await db.job.count({ where: { boardId } })).toBe(1);
    await request(`boards/${boardId}`, 'PATCH', { enabled: true });
  });
  it('updates instead of duplicating, closes missing jobs, and reactivates returning jobs', async () => {
    const aggregation = new Aggregation(db),
      board = await db.board.findUniqueOrThrow({ where: { id: boardId } });
    await aggregation.importBoard(board, [{ ...listing, title: 'Updated engineer' }]);
    await aggregation.importBoard(board, [{ ...listing, title: 'Updated engineer' }]);
    expect(await db.job.count({ where: { boardId } })).toBe(1);
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).title).toBe('Updated engineer');
    await aggregation.importBoard(board, []);
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).active).toBe(false);
    expect((await new Jobs(db).list(jobQuerySchema.parse({ boardId, active: 'false' }))).items).toHaveLength(
      1,
    );
    await aggregation.importBoard(board, [listing]);
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).active).toBe(true);
  });
  it('keeps existing jobs when fetching fails and synchronizes only selected boards', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('HTTP 503'));
    const aggregation = new Aggregation(db);
    const result = await aggregation.syncAll(fetcher);
    expect(result.find((entry) => entry.board === `test-${boardId}`)?.error).toContain('503');
    expect(fetcher.mock.calls.some(([, slug]) => slug === `test-${hiddenId}`)).toBe(false);
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).active).toBe(true);
    expect((await db.board.findUniqueOrThrow({ where: { id: boardId } })).lastError).toContain('503');
    expect(aggregation.status()).toMatchObject({ running: false, completed: result.length });
  });
  it('skips a company deselected while a fetch is in progress', async () => {
    const aggregation = new Aggregation(db),
      stale = await db.board.findUniqueOrThrow({ where: { id: boardId } });
    await db.board.update({ where: { id: boardId }, data: { enabled: false } });
    expect(await aggregation.importBoard(stale, [])).toMatchObject({ skipped: true });
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).active).toBe(true);
    await db.board.update({ where: { id: boardId }, data: { enabled: true } });
  });
});
