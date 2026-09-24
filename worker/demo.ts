import { and, count, eq, gt, like, lt } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { isBuiltinChannel } from '../src/domain/channels';
import { normalizeCompanyName } from '../src/domain/companies';
import { createSampleData, type SampleData } from '../src/domain/sampleData';
import type { Db } from './db';
import { user } from './db/auth-schema';
import { insertRows } from './db/insert';
import * as t from './db/schema';
import { toEventRow } from './repository';

/**
 * The public demo gives each visitor a private sandbox of sample data in the demo database, identified by a
 * signed cookie. Sandboxes expire after a day and are purged by the cron trigger.
 */

export const DEMO_TTL_MS = 24 * 60 * 60 * 1000;
/** Sandboxes created per day at most, so demo traffic can't use up the account's D1 write quota. */
export const DEMO_DAILY_CAP = 200;
const DEMO_USER_PREFIX = 'demo_';

export const isDemoUserId = (id: string) => id.startsWith(DEMO_USER_PREFIX);

/** Suffixes every sample row id so sandboxes can share one database. Built-in channel ids stay shared. */
function namespaced(data: SampleData, suffix: string): SampleData {
  const own = (id: string) => `${id}_${suffix}`;
  const ownNullable = (id: string | null) => (id === null ? null : own(id));
  return {
    accounts: data.accounts.map((a) => ({ ...a, id: own(a.id) })),
    resumes: data.resumes.map((r) => ({ ...r, id: own(r.id) })),
    channels: data.channels,
    companies: data.companies.map((c) => ({ ...c, id: own(c.id) })),
    jobs: data.jobs.map((j) => ({ ...j, id: own(j.id), companyId: own(j.companyId) })),
    applications: data.applications.map((a) => ({
      ...a,
      id: own(a.id),
      jobId: own(a.jobId),
      accountId: own(a.accountId),
      resumeId: ownNullable(a.resumeId),
      channelId: a.channelId === null || isBuiltinChannel(a.channelId) ? a.channelId : own(a.channelId),
    })),
    events: data.events.map((e) => ({
      ...e,
      id: own(e.id),
      jobId: own(e.jobId),
      applicationId: ownNullable(e.applicationId),
      accountId: ownNullable(e.accountId),
    })),
  };
}

function seedWrites(db: Db, userId: string, now: Date): BatchItem<'sqlite'>[] {
  const data = namespaced(createSampleData(now), userId.slice(DEMO_USER_PREFIX.length));
  return [
    ...insertRows(
      db,
      t.identities,
      data.accounts.map((a) => ({ ...a, userId })),
    ),
    ...insertRows(
      db,
      t.resumes,
      data.resumes.map((r) => ({ ...r, userId })),
    ),
    ...insertRows(
      db,
      t.companies,
      data.companies.map((c) => ({ ...c, userId, normalizedName: normalizeCompanyName(c.name) })),
    ),
    ...insertRows(
      db,
      t.jobs,
      data.jobs.map((j) => ({ ...j, userId })),
    ),
    ...insertRows(
      db,
      t.applications,
      data.applications.map((a) => ({ ...a, userId })),
    ),
    ...insertRows(
      db,
      t.events,
      data.events.map((e) => toEventRow(e, userId)),
    ),
  ];
}

async function runBatch(db: Db, writes: BatchItem<'sqlite'>[]) {
  const [first, ...rest] = writes;
  if (first) await db.batch([first, ...rest]);
}

export type DemoStart = { ok: true; userId: string } | { ok: false; reason: 'busy' };

export async function createDemoSandbox(
  db: Db,
  { now = new Date(), dailyCap = DEMO_DAILY_CAP }: { now?: Date; dailyCap?: number } = {},
): Promise<DemoStart> {
  const [recent] = await db
    .select({ value: count() })
    .from(user)
    .where(
      and(like(user.id, `${DEMO_USER_PREFIX}%`), gt(user.createdAt, new Date(now.getTime() - DEMO_TTL_MS))),
    );
  if ((recent?.value ?? 0) >= dailyCap) return { ok: false, reason: 'busy' };

  const userId = `${DEMO_USER_PREFIX}${crypto.randomUUID().replaceAll('-', '')}`;
  await runBatch(db, [
    db.insert(user).values({
      id: userId,
      name: 'Demo visitor',
      email: `${userId}@demo.outbox`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    }),
    ...seedWrites(db, userId, now),
  ]);
  return { ok: true, userId };
}

/** Puts a sandbox back to fresh sample data, in one batch. */
export async function resetDemoSandbox(db: Db, userId: string, now = new Date()): Promise<void> {
  await runBatch(db, [
    // Children before parents: events and applications, then jobs, then what they point at.
    db.delete(t.events).where(eq(t.events.userId, userId)),
    db.delete(t.applications).where(eq(t.applications.userId, userId)),
    db.delete(t.jobs).where(eq(t.jobs.userId, userId)),
    db.delete(t.companies).where(eq(t.companies.userId, userId)),
    db.delete(t.identities).where(eq(t.identities.userId, userId)),
    db.delete(t.resumes).where(eq(t.resumes.userId, userId)),
    db.delete(t.channels).where(eq(t.channels.userId, userId)),
    ...seedWrites(db, userId, now),
  ]);
}

/** Deletes sandboxes older than a day. Every table cascades from `user`, so their rows go with them. */
export async function purgeExpiredDemos(db: Db, now = new Date()): Promise<void> {
  await db
    .delete(user)
    .where(
      and(like(user.id, `${DEMO_USER_PREFIX}%`), lt(user.createdAt, new Date(now.getTime() - DEMO_TTL_MS))),
    );
}
