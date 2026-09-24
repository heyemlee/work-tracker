import type { NewApplication, QuickAddInput, QuickAddResult } from './repository';
import type { Application, Company, Id, IsoDateTime, Job, Stage, TimelineEvent } from './types';

/**
 * The rules for every write that touches applications, as pure functions. Repositories gather the facts a
 * command needs, call it, and persist the result — so the browser-local and D1 implementations can't drift.
 */

export interface Clock {
  now(): IsoDateTime;
  newId(prefix: string): Id;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
  newId: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
};

type EventFields = Omit<TimelineEvent, 'id' | 'at' | 'actor'>;

function event(clock: Clock, at: IsoDateTime, fields: EventFields): TimelineEvent {
  return { id: clock.newId('evt'), at, actor: 'user', ...fields };
}

export interface QuickAddContext {
  /** The company with the same normalized name, if one exists. Ignored when attaching to a job. */
  existingCompany: Company | undefined;
  /** Accounts that already applied to the target job. */
  takenAccountIds: ReadonlySet<Id>;
}

export interface QuickAddPlan {
  company: Company | null;
  job: Job | null;
  applications: Application[];
  events: TimelineEvent[];
  result: QuickAddResult;
}

export function planQuickAdd(input: QuickAddInput, context: QuickAddContext, clock: Clock): QuickAddPlan {
  const at = clock.now();
  let company: Company | null = null;
  let job: Job | null = null;
  let jobId = input.jobId;

  if (!jobId) {
    let companyId = context.existingCompany?.id;
    if (!companyId) {
      company = { id: clock.newId('co'), name: input.companyName.trim(), createdAt: at };
      companyId = company.id;
    }
    job = {
      id: clock.newId('job'),
      companyId,
      title: input.title?.trim() || null,
      notes: '',
      createdAt: at,
      updatedAt: at,
    };
    jobId = job.id;
  }

  const targetJobId: Id = jobId;
  const applications = [...new Set(input.accountIds)]
    .filter((accountId) => !context.takenAccountIds.has(accountId))
    .map((accountId): Application => ({
      id: clock.newId('app'),
      jobId: targetJobId,
      accountId,
      channelId: input.channelId,
      resumeId: input.resumeId,
      stage: 'applied',
      rejected: false,
      appliedAt: input.appliedAt,
      source: 'user',
      createdAt: at,
      updatedAt: at,
    }));

  const events: TimelineEvent[] = [];
  // "Job saved" only says something for a job saved without applying; otherwise "applied" says it all.
  if (job && applications.length === 0) {
    events.push(
      event(clock, at, {
        jobId: targetJobId,
        applicationId: null,
        accountId: null,
        type: 'job_created',
        from: null,
        to: null,
      }),
    );
  }
  for (const app of applications) {
    events.push(
      event(clock, at, {
        jobId: targetJobId,
        applicationId: app.id,
        accountId: app.accountId,
        type: 'applied',
        from: null,
        to: 'applied',
      }),
    );
  }

  return {
    company,
    job,
    applications,
    events,
    result: {
      jobId: targetJobId,
      createdJobId: job?.id ?? null,
      createdCompanyId: company?.id ?? null,
      applicationIds: applications.map((a) => a.id),
    },
  };
}

export interface ApplicationChange {
  application: Application;
  event: TimelineEvent;
}

export function planAddApplication(input: NewApplication, clock: Clock): ApplicationChange {
  const at = clock.now();
  const application: Application = {
    id: clock.newId('app'),
    ...input,
    stage: 'applied',
    rejected: false,
    source: 'user',
    createdAt: at,
    updatedAt: at,
  };
  return {
    application,
    event: event(clock, at, {
      jobId: input.jobId,
      applicationId: application.id,
      accountId: input.accountId,
      type: 'applied',
      from: null,
      to: 'applied',
    }),
  };
}

/** Null when nothing changes, so no timeline entry is written. */
export function planStageChange(app: Application, stage: Stage, clock: Clock): ApplicationChange | null {
  if (app.stage === stage) return null;
  const at = clock.now();
  return {
    application: { ...app, stage, updatedAt: at },
    event: event(clock, at, {
      jobId: app.jobId,
      applicationId: app.id,
      accountId: app.accountId,
      type: 'stage_changed',
      from: app.stage,
      to: stage,
    }),
  };
}

export function planRejectedChange(
  app: Application,
  rejected: boolean,
  clock: Clock,
): ApplicationChange | null {
  if (app.rejected === rejected) return null;
  const at = clock.now();
  return {
    application: { ...app, rejected, updatedAt: at },
    event: event(clock, at, {
      jobId: app.jobId,
      applicationId: app.id,
      accountId: app.accountId,
      type: rejected ? 'rejected' : 'unrejected',
      from: app.stage,
      to: app.stage,
    }),
  };
}

/** The application row goes away; its timeline entry stays, named by account. */
export function planRemoveApplication(app: Application, clock: Clock): TimelineEvent {
  return event(clock, clock.now(), {
    jobId: app.jobId,
    applicationId: null,
    accountId: app.accountId,
    type: 'application_removed',
    from: app.stage,
    to: null,
  });
}
