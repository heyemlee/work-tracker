import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { BUILTIN_CHANNELS, isBuiltinChannel } from '../src/domain/channels';
import {
  planAddApplication,
  planQuickAdd,
  planRejectedChange,
  planRemoveApplication,
  planStageChange,
  systemClock,
  type ApplicationChange,
  type Clock,
} from '../src/domain/commands';
import { normalizeCompanyName } from '../src/domain/companies';
import { ConflictError, NotFoundError } from '../src/domain/errors';
import type { Repository } from '../src/domain/repository';
import type {
  Account,
  Application,
  Channel,
  Company,
  Id,
  Job,
  ResumeVersion,
  TimelineEvent,
} from '../src/domain/types';
import type { Db } from './db';
import { insertRows } from './db/insert';
import * as t from './db/schema';

type Write = BatchItem<'sqlite'>;

const toAccount = (row: typeof t.identities.$inferSelect): Account => ({
  id: row.id,
  label: row.label,
  email: row.email,
  color: row.color,
  createdAt: row.createdAt,
});

const toResume = (row: typeof t.resumes.$inferSelect): ResumeVersion => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
});

const toChannel = (row: typeof t.channels.$inferSelect): Channel => ({
  id: row.id,
  name: row.name,
  builtin: false,
});

const toCompany = (row: typeof t.companies.$inferSelect): Company => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
});

const toJob = (row: typeof t.jobs.$inferSelect): Job => ({
  id: row.id,
  companyId: row.companyId,
  title: row.title,
  notes: row.notes,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toApplication = (row: typeof t.applications.$inferSelect): Application => ({
  id: row.id,
  jobId: row.jobId,
  accountId: row.accountId,
  channelId: row.channelId,
  resumeId: row.resumeId,
  stage: row.stage,
  rejected: row.rejected,
  appliedAt: row.appliedAt,
  source: row.source,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toEvent = (row: typeof t.events.$inferSelect): TimelineEvent => ({
  id: row.id,
  jobId: row.jobId,
  applicationId: row.applicationId,
  accountId: row.accountId,
  type: row.type,
  from: row.fromStage,
  to: row.toStage,
  actor: row.actor,
  at: row.at,
});

/** A timeline entry as an `events` row owned by `userId`. */
export const toEventRow = (e: TimelineEvent, userId: Id): typeof t.events.$inferInsert => ({
  id: e.id,
  userId,
  jobId: e.jobId,
  applicationId: e.applicationId,
  accountId: e.accountId,
  type: e.type,
  fromStage: e.from,
  toStage: e.to,
  actor: e.actor,
  at: e.at,
});

/** The Repository contract over D1, scoped to one user: every query filters on `user_id`. */
export function createD1Repository(db: Db, userId: Id, clock: Clock = systemClock): Repository {
  const eventRow = (e: TimelineEvent) => toEventRow(e, userId);

  /** Runs writes as one D1 batch, which commits or rolls back as a unit. */
  async function commit(writes: Write[]) {
    const [first, ...rest] = writes;
    if (first) await db.batch([first, ...rest]);
  }

  async function liveJob(id: Id): Promise<Job> {
    const row = await db
      .select()
      .from(t.jobs)
      .where(and(eq(t.jobs.id, id), eq(t.jobs.userId, userId), isNull(t.jobs.deletedAt)))
      .get();
    if (!row) throw new NotFoundError('Job', id);
    return toJob(row);
  }

  async function liveApplication(id: Id): Promise<Application> {
    const row = await db
      .select({ application: t.applications })
      .from(t.applications)
      .innerJoin(t.jobs, eq(t.jobs.id, t.applications.jobId))
      .where(and(eq(t.applications.id, id), eq(t.applications.userId, userId), isNull(t.jobs.deletedAt)))
      .get();
    if (!row) throw new NotFoundError('Application', id);
    return toApplication(row.application);
  }

  async function requireAccounts(ids: Id[]) {
    if (ids.length === 0) return;
    const rows = await db
      .select({ id: t.identities.id })
      .from(t.identities)
      .where(and(eq(t.identities.userId, userId), inArray(t.identities.id, ids)))
      .all();
    const found = new Set(rows.map((row) => row.id));
    const missing = ids.find((id) => !found.has(id));
    if (missing) throw new NotFoundError('Account', missing);
  }

  /** Channel and resume ids must be built in or belong to this user. */
  async function requireReferences(channelId: Id | null | undefined, resumeId: Id | null | undefined) {
    if (channelId && !isBuiltinChannel(channelId)) {
      const row = await db
        .select({ id: t.channels.id })
        .from(t.channels)
        .where(and(eq(t.channels.id, channelId), eq(t.channels.userId, userId)))
        .get();
      if (!row) throw new NotFoundError('Channel', channelId);
    }
    if (resumeId) {
      const row = await db
        .select({ id: t.resumes.id })
        .from(t.resumes)
        .where(and(eq(t.resumes.id, resumeId), eq(t.resumes.userId, userId)))
        .get();
      if (!row) throw new NotFoundError('Resume', resumeId);
    }
  }

  async function applyChange(change: ApplicationChange | null) {
    if (!change) return;
    const { application, event } = change;
    await commit([
      db
        .update(t.applications)
        .set({ stage: application.stage, rejected: application.rejected, updatedAt: application.updatedAt })
        .where(and(eq(t.applications.id, application.id), eq(t.applications.userId, userId))),
      db.insert(t.events).values(eventRow(event)),
    ]);
  }

  /** Updates one owned row; NotFoundError when nothing matched. */
  async function renameOwned(
    table: typeof t.resumes | typeof t.channels,
    what: string,
    id: Id,
    name: string,
  ) {
    const updated = await db
      .update(table)
      .set({ name })
      .where(and(eq(table.id, id), eq(table.userId, userId)))
      .returning({ id: table.id });
    if (updated.length === 0) throw new NotFoundError(what, id);
  }

  return {
    async load() {
      const [accounts, resumes, channels, companies, jobs, applications] = await db.batch([
        db
          .select()
          .from(t.identities)
          .where(eq(t.identities.userId, userId))
          .orderBy(asc(t.identities.createdAt)),
        db.select().from(t.resumes).where(eq(t.resumes.userId, userId)).orderBy(asc(t.resumes.createdAt)),
        db.select().from(t.channels).where(eq(t.channels.userId, userId)).orderBy(asc(t.channels.createdAt)),
        db.select().from(t.companies).where(eq(t.companies.userId, userId)),
        db
          .select()
          .from(t.jobs)
          .where(and(eq(t.jobs.userId, userId), isNull(t.jobs.deletedAt))),
        db
          .select({ application: t.applications })
          .from(t.applications)
          .innerJoin(t.jobs, eq(t.jobs.id, t.applications.jobId))
          .where(and(eq(t.applications.userId, userId), isNull(t.jobs.deletedAt))),
      ]);
      return {
        accounts: accounts.map(toAccount),
        resumes: resumes.map(toResume),
        channels: [...BUILTIN_CHANNELS, ...channels.map(toChannel)],
        companies: companies.map(toCompany),
        jobs: jobs.map(toJob),
        applications: applications.map((row) => toApplication(row.application)),
      };
    },

    async loadEvents(jobId) {
      await liveJob(jobId);
      const rows = await db
        .select()
        .from(t.events)
        .where(and(eq(t.events.userId, userId), eq(t.events.jobId, jobId)))
        // Newest first; among same-instant events, the one recorded last comes first.
        .orderBy(desc(t.events.at), desc(sql`rowid`))
        .all();
      return rows.map(toEvent);
    },

    async quickAdd(input) {
      if (input.jobId) await liveJob(input.jobId);
      await requireAccounts(input.accountIds);
      await requireReferences(input.channelId, input.resumeId);

      const existingCompany = input.jobId
        ? undefined
        : await db
            .select()
            .from(t.companies)
            .where(
              and(
                eq(t.companies.userId, userId),
                eq(t.companies.normalizedName, normalizeCompanyName(input.companyName)),
              ),
            )
            .get();
      const taken = input.jobId
        ? await db
            .select({ accountId: t.applications.accountId })
            .from(t.applications)
            .where(and(eq(t.applications.userId, userId), eq(t.applications.jobId, input.jobId)))
            .all()
        : [];

      const plan = planQuickAdd(
        input,
        {
          existingCompany: existingCompany && toCompany(existingCompany),
          takenAccountIds: new Set(taken.map((row) => row.accountId)),
        },
        clock,
      );

      const writes: Write[] = [];
      if (plan.company) {
        writes.push(
          db
            .insert(t.companies)
            .values({ ...plan.company, userId, normalizedName: normalizeCompanyName(plan.company.name) }),
        );
      }
      if (plan.job) writes.push(db.insert(t.jobs).values({ ...plan.job, userId }));
      writes.push(
        ...insertRows(
          db,
          t.applications,
          plan.applications.map((a) => ({ ...a, userId })),
        ),
        ...insertRows(db, t.events, plan.events.map(eventRow)),
      );
      await commit(writes);
      return plan.result;
    },

    async undoQuickAdd({ createdJobId, createdCompanyId, applicationIds }) {
      const writes: Write[] = [];
      if (applicationIds.length > 0) {
        writes.push(
          db
            .delete(t.events)
            .where(and(eq(t.events.userId, userId), inArray(t.events.applicationId, applicationIds))),
          db
            .delete(t.applications)
            .where(and(eq(t.applications.userId, userId), inArray(t.applications.id, applicationIds))),
        );
      }
      if (createdJobId) {
        // Applications and events of the job go with it (ON DELETE CASCADE).
        writes.push(db.delete(t.jobs).where(and(eq(t.jobs.id, createdJobId), eq(t.jobs.userId, userId))));
      }
      if (createdCompanyId) {
        // Only if no other job was added to the company in the meantime.
        const unused: SQL = sql`not exists (select 1 from ${t.jobs} where ${t.jobs.companyId} = ${createdCompanyId})`;
        writes.push(
          db
            .delete(t.companies)
            .where(and(eq(t.companies.id, createdCompanyId), eq(t.companies.userId, userId), unused)),
        );
      }
      await commit(writes);
    },

    async addApplication(input) {
      await liveJob(input.jobId);
      await requireAccounts([input.accountId]);
      await requireReferences(input.channelId, input.resumeId);
      const existing = await db
        .select({ id: t.applications.id })
        .from(t.applications)
        .where(and(eq(t.applications.jobId, input.jobId), eq(t.applications.accountId, input.accountId)))
        .get();
      if (existing) throw new ConflictError('This account already applied to this job');

      const { application, event } = planAddApplication(input, clock);
      await commit([
        db.insert(t.applications).values({ ...application, userId }),
        db.insert(t.events).values(eventRow(event)),
      ]);
      return application.id;
    },

    async removeApplication(id) {
      const application = await liveApplication(id);
      await commit([
        db.delete(t.applications).where(and(eq(t.applications.id, id), eq(t.applications.userId, userId))),
        db.insert(t.events).values(eventRow(planRemoveApplication(application, clock))),
      ]);
    },

    async setStage(id, stage) {
      await applyChange(planStageChange(await liveApplication(id), stage, clock));
    },

    async setRejected(id, rejected) {
      await applyChange(planRejectedChange(await liveApplication(id), rejected, clock));
    },

    async updateApplication(id, patch) {
      await liveApplication(id);
      await requireReferences(patch.channelId, patch.resumeId);
      await db
        .update(t.applications)
        .set({ ...patch, updatedAt: clock.now() })
        .where(and(eq(t.applications.id, id), eq(t.applications.userId, userId)));
    },

    async updateJob(id, patch) {
      await liveJob(id);
      await db
        .update(t.jobs)
        .set({ ...patch, updatedAt: clock.now() })
        .where(and(eq(t.jobs.id, id), eq(t.jobs.userId, userId)));
    },

    async deleteJob(id) {
      await liveJob(id);
      await db
        .update(t.jobs)
        .set({ deletedAt: clock.now() })
        .where(and(eq(t.jobs.id, id), eq(t.jobs.userId, userId)));
    },

    async restoreJob(id) {
      const restored = await db
        .update(t.jobs)
        .set({ deletedAt: null })
        .where(and(eq(t.jobs.id, id), eq(t.jobs.userId, userId), isNotNull(t.jobs.deletedAt)))
        .returning({ id: t.jobs.id });
      if (restored.length === 0) throw new NotFoundError('Deleted job', id);
    },

    async saveAccount({ id, label, email, color }) {
      if (id) {
        const updated = await db
          .update(t.identities)
          .set({ label, email, color })
          .where(and(eq(t.identities.id, id), eq(t.identities.userId, userId)))
          .returning({ id: t.identities.id });
        if (updated.length === 0) throw new NotFoundError('Account', id);
        return id;
      }
      const account = { id: clock.newId('acc'), label, email, color, createdAt: clock.now() };
      await db.insert(t.identities).values({ ...account, userId });
      return account.id;
    },

    async deleteAccount(id) {
      const used = await db
        .select({ id: t.applications.id })
        .from(t.applications)
        .where(and(eq(t.applications.accountId, id), eq(t.applications.userId, userId)))
        .get();
      if (used) throw new ConflictError('Account is in use');
      await db.delete(t.identities).where(and(eq(t.identities.id, id), eq(t.identities.userId, userId)));
    },

    async saveResume({ id, name }) {
      if (id) {
        await renameOwned(t.resumes, 'Resume', id, name);
        return id;
      }
      const resume = { id: clock.newId('res'), name, createdAt: clock.now() };
      await db.insert(t.resumes).values({ ...resume, userId });
      return resume.id;
    },

    async deleteResume(id) {
      // Applications keep their row; resume_id is cleared by ON DELETE SET NULL.
      await db.delete(t.resumes).where(and(eq(t.resumes.id, id), eq(t.resumes.userId, userId)));
    },

    async saveChannel({ id, name }) {
      if (id) {
        if (isBuiltinChannel(id)) throw new ConflictError('Built-in channels cannot be renamed');
        await renameOwned(t.channels, 'Channel', id, name);
        return id;
      }
      const channel = { id: clock.newId('ch'), name, createdAt: clock.now() };
      await db.insert(t.channels).values({ ...channel, userId });
      return channel.id;
    },

    async deleteChannel(id) {
      if (isBuiltinChannel(id)) throw new ConflictError('Built-in channels cannot be deleted');
      await commit([
        db
          .update(t.applications)
          .set({ channelId: null })
          .where(and(eq(t.applications.channelId, id), eq(t.applications.userId, userId))),
        db.delete(t.channels).where(and(eq(t.channels.id, id), eq(t.channels.userId, userId))),
      ]);
    },
  };
}
