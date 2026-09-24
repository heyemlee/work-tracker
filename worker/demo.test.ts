import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSampleData } from '../src/domain/sampleData';
import type { Snapshot } from '../src/domain/types';
import type { Db } from './db';
import { user } from './db/auth-schema';
import * as t from './db/schema';
import { createDemoSandbox, DEMO_TTL_MS, purgeExpiredDemos } from './demo';
import { createD1Repository } from './repository';
import { startTestDatabase } from './testing';

let db: Db;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, dispose } = await startTestDatabase());
}, 30_000);

afterAll(async () => {
  await dispose?.();
});

async function sandbox(now = new Date()): Promise<string> {
  const started = await createDemoSandbox(db, { now });
  if (!started.ok) throw new Error('The demo is busy');
  return started.userId;
}

const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));

/** A snapshot in a comparable form: sandbox id suffixes removed, rows in id order. */
function comparable(snapshot: Snapshot, userId?: string) {
  const suffix = userId ? `_${userId.replace(/^demo_/, '')}` : null;
  const plain = suffix ? (JSON.parse(JSON.stringify(snapshot).replaceAll(suffix, '')) as Snapshot) : snapshot;
  return {
    accounts: byId(plain.accounts),
    resumes: byId(plain.resumes),
    channels: byId(plain.channels),
    companies: byId(plain.companies),
    jobs: byId(plain.jobs),
    applications: byId(plain.applications),
  };
}

const tables = {
  identities: t.identities,
  resumes: t.resumes,
  channels: t.channels,
  companies: t.companies,
  jobs: t.jobs,
  applications: t.applications,
  events: t.events,
};

async function rowCounts(userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await db.select({ value: count() }).from(table).where(eq(table.userId, userId));
    counts[name] = row?.value ?? 0;
  }
  return counts;
}

describe('demo sandboxes', () => {
  it('start with the sample data', async () => {
    const now = new Date();
    const userId = await sandbox(now);
    const snapshot = await createD1Repository(db, userId).load();
    expect(comparable(snapshot, userId)).toEqual(comparable(createSampleData(now)));
  });

  it('keep each visitor’s changes to themselves', async () => {
    const now = new Date();
    const alice = createD1Repository(db, await sandbox(now));
    const bobId = await sandbox(now);
    const [job] = (await alice.load()).jobs;
    await alice.deleteJob(job?.id ?? '');
    expect(comparable(await createD1Repository(db, bobId).load(), bobId)).toEqual(
      comparable(createSampleData(now)),
    );
  });

  it('are purged after a day, with everything in them', async () => {
    const now = new Date();
    const expired = await sandbox(new Date(now.getTime() - DEMO_TTL_MS - 60_000));
    const recent = await sandbox(new Date(now.getTime() - DEMO_TTL_MS + 60_000));
    // Owners are never purged, however old.
    await db.insert(user).values({
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.com',
      emailVerified: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    expect((await rowCounts(expired)).events).toBeGreaterThan(0);

    await purgeExpiredDemos(db, now);

    const remaining = (await db.select({ id: user.id }).from(user)).map((row) => row.id);
    expect(remaining).not.toContain(expired);
    expect(remaining).toEqual(expect.arrayContaining([recent, 'owner']));
    expect(Object.values(await rowCounts(expired)).every((n) => n === 0)).toBe(true);
    expect((await rowCounts(recent)).events).toBeGreaterThan(0);
  });

  it('stop at the daily cap', async () => {
    // Far enough ahead that sandboxes from the other tests fall outside the window.
    const now = new Date('2031-01-01T12:00:00Z');
    expect((await createDemoSandbox(db, { now, dailyCap: 1 })).ok).toBe(true);
    expect(await createDemoSandbox(db, { now, dailyCap: 1 })).toEqual({ ok: false, reason: 'busy' });
    // A day later the window has moved on.
    const tomorrow = new Date(now.getTime() + DEMO_TTL_MS + 1);
    expect((await createDemoSandbox(db, { now: tomorrow, dailyCap: 1 })).ok).toBe(true);
  });
});
