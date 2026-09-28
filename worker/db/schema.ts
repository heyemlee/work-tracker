import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { ACCOUNT_COLORS, ACTORS, EVENT_TYPES, STAGES } from '../../src/domain/types';
import { user } from './auth-schema';

// Timestamps are ISO-8601 text, matching the domain types; they sort correctly as strings.
// Every foreign key's column is indexed: SQLite looks it up whenever a parent row is deleted, and without an
// index each lookup scans the whole table.

const ownerId = () =>
  text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });

/** The domain's Account: an email identity the owner applies with. "account" is taken by Better Auth. */
export const identities = sqliteTable(
  'identities',
  {
    id: text('id').primaryKey(),
    userId: ownerId(),
    label: text('label').notNull(),
    email: text('email').notNull().default(''),
    color: text('color', { enum: ACCOUNT_COLORS }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('identities_user_idx').on(table.userId)],
);

export const resumes = sqliteTable(
  'resumes',
  {
    id: text('id').primaryKey(),
    userId: ownerId(),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('resumes_user_idx').on(table.userId)],
);

/** User-defined channels only; the built-in ones live in code. */
export const channels = sqliteTable(
  'channels',
  {
    id: text('id').primaryKey(),
    userId: ownerId(),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('channels_user_idx').on(table.userId)],
);

export const companies = sqliteTable(
  'companies',
  {
    id: text('id').primaryKey(),
    userId: ownerId(),
    name: text('name').notNull(),
    /** See normalizeCompanyName: "Stripe, Inc." and "stripe" are one company. */
    normalizedName: text('normalized_name').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('companies_user_name_idx').on(table.userId, table.normalizedName)],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    userId: ownerId(),
    // No cascade: a company is only removed once no job points at it.
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id),
    title: text('title'),
    url: text('url'),
    notes: text('notes').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    /** Soft delete, so deleting a job can be undone. */
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('jobs_user_idx').on(table.userId, table.deletedAt),
    index('jobs_company_idx').on(table.companyId),
  ],
);

export const applications = sqliteTable(
  'applications',
  {
    id: text('id').primaryKey(),
    userId: ownerId(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    // No cascade: an identity can't be deleted while applications use it.
    accountId: text('account_id')
      .notNull()
      .references(() => identities.id),
    // Built-in channel ids live in code, so this can't be a foreign key.
    channelId: text('channel_id'),
    resumeId: text('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    stage: text('stage', { enum: STAGES }).notNull(),
    rejected: integer('rejected', { mode: 'boolean' }).notNull().default(false),
    appliedAt: text('applied_at').notNull(),
    source: text('source', { enum: ACTORS }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('applications_job_account_idx').on(table.jobId, table.accountId),
    index('applications_user_idx').on(table.userId),
    index('applications_account_idx').on(table.accountId),
    index('applications_resume_idx').on(table.resumeId),
  ],
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    userId: ownerId(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    // Plain columns: the entry outlives a removed application and still names its account.
    applicationId: text('application_id'),
    accountId: text('account_id'),
    type: text('type', { enum: EVENT_TYPES }).notNull(),
    fromStage: text('from_stage', { enum: STAGES }),
    toStage: text('to_stage', { enum: STAGES }),
    actor: text('actor', { enum: ACTORS }).notNull(),
    at: text('at').notNull(),
  },
  (table) => [
    index('events_user_idx').on(table.userId),
    index('events_job_idx').on(table.jobId, table.at),
    index('events_application_idx').on(table.applicationId),
  ],
);

/** The autofill profile: one JSON document per user, validated by the domain's profile schema on the way in. */
export const profiles = sqliteTable('profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  data: text('data', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
});
