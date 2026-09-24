import type { Account, Application, Company, Job, Snapshot } from './types';

const T0 = '2026-09-01T12:00:00.000Z';

export function account(id: string, label = id.toUpperCase()): Account {
  return { id, label, email: `${id}@example.com`, color: 'blue', createdAt: T0 };
}

export function company(id: string, name: string): Company {
  return { id, name, createdAt: T0 };
}

export function job(id: string, companyId: string, title: string | null = null, createdAt = T0): Job {
  return { id, companyId, title, notes: '', createdAt, updatedAt: createdAt };
}

export function application(
  id: string,
  jobId: string,
  accountId: string,
  overrides: Partial<Application> = {},
): Application {
  return {
    id,
    jobId,
    accountId,
    channelId: null,
    resumeId: null,
    stage: 'applied',
    rejected: false,
    appliedAt: '2026-09-01',
    source: 'user',
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function snapshot(parts: Partial<Snapshot> = {}): Snapshot {
  return {
    accounts: [],
    resumes: [],
    channels: [],
    companies: [],
    jobs: [],
    applications: [],
    events: [],
    ...parts,
  };
}
