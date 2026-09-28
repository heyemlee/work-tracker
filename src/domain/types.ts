/** Application stages, in pipeline order. "Saved" is not a stage: it is a job with no applications. */
export const STAGES = ['applied', 'oa', 'offer'] as const;
export type Stage = (typeof STAGES)[number];

/** What a job displays after rolling up its applications. */
export type JobStatus = 'saved' | Stage;

export const ACCOUNT_COLORS = ['blue', 'purple', 'pink', 'orange', 'green', 'teal', 'gray'] as const;
export type AccountColor = (typeof ACCOUNT_COLORS)[number];

export type Id = string;
/** A full timestamp, e.g. `2026-09-23T17:04:00.000Z`. */
export type IsoDateTime = string;
/** A calendar date in the owner's time zone, e.g. `2026-09-23`. */
export type IsoDate = string;

export const ACTORS = ['user', 'agent'] as const;
export type Actor = (typeof ACTORS)[number];

/** An email identity the owner applies with. Never holds a password. */
export interface Account {
  id: Id;
  label: string;
  email: string;
  color: AccountColor;
  createdAt: IsoDateTime;
}

export interface ResumeVersion {
  id: Id;
  name: string;
  createdAt: IsoDateTime;
}

/** How an application was submitted. Built-in channels store an i18n key as their name. */
export interface Channel {
  id: Id;
  name: string;
  builtin: boolean;
}

export interface Company {
  id: Id;
  name: string;
  createdAt: IsoDateTime;
}

/** One posting. Title, link and notes are optional by design — only the company is required. */
export interface Job {
  id: Id;
  companyId: Id;
  title: string | null;
  /** The posting's page, when the owner pasted or entered it. */
  url: string | null;
  notes: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** One submission of a job from one account. At most one per (job, account). */
export interface Application {
  id: Id;
  jobId: Id;
  accountId: Id;
  channelId: Id | null;
  resumeId: Id | null;
  stage: Stage;
  /** A flag rather than a stage, so "rejected after OA" keeps its stage. */
  rejected: boolean;
  appliedAt: IsoDate;
  source: Actor;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const EVENT_TYPES = [
  'job_created',
  'applied',
  'stage_changed',
  'rejected',
  'unrejected',
  'application_removed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Append-only timeline entry, written on every change. */
export interface TimelineEvent {
  id: Id;
  jobId: Id;
  applicationId: Id | null;
  /** Denormalized so the entry still reads correctly after the application is removed. */
  accountId: Id | null;
  type: EventType;
  from: Stage | null;
  to: Stage | null;
  actor: Actor;
  at: IsoDateTime;
}

/**
 * Everything the list views need. A single owner's data stays small enough to load at once; timelines are
 * left out and loaded per job.
 */
export interface Snapshot {
  accounts: Account[];
  resumes: ResumeVersion[];
  channels: Channel[];
  companies: Company[];
  jobs: Job[];
  applications: Application[];
}
