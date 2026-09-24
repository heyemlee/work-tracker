import { groupBy, indexBy } from './collections';
import { groupKeyFor, localDateOf, startOfWeek, type GroupKey } from './dates';
import { rollup } from './stages';
import type {
  Account,
  Application,
  Company,
  Id,
  IsoDate,
  IsoDateTime,
  Job,
  JobStatus,
  Snapshot,
} from './types';

/** A job joined with everything the list needs to render it. */
export interface JobRow {
  job: Job;
  company: Company;
  /** Ordered like the account list, so chips never reshuffle. */
  applications: Application[];
  status: JobStatus;
  rejected: boolean;
  /** Latest applied date, or the day the job was saved. Drives grouping. */
  sortDate: IsoDate;
  /** Latest activity timestamp, to order rows within a day. */
  sortTime: IsoDateTime;
}

export function buildRows(snapshot: Snapshot): JobRow[] {
  const companies = indexBy(snapshot.companies, (c) => c.id);
  const applicationsByJob = groupBy(snapshot.applications, (a) => a.jobId);
  const accountOrder = new Map(snapshot.accounts.map((a, i) => [a.id, i]));
  const order = (a: Application) => accountOrder.get(a.accountId) ?? Number.MAX_SAFE_INTEGER;

  const rows: JobRow[] = [];
  for (const job of snapshot.jobs) {
    const company = companies.get(job.companyId);
    if (!company) continue;
    const applications = [...(applicationsByJob.get(job.id) ?? [])].sort((a, b) => order(a) - order(b));
    let sortDate: IsoDate | null = null;
    let sortTime = job.createdAt;
    for (const app of applications) {
      if (sortDate === null || app.appliedAt > sortDate) sortDate = app.appliedAt;
      if (app.createdAt > sortTime) sortTime = app.createdAt;
    }
    rows.push({
      job,
      company,
      applications,
      ...rollup(applications),
      sortDate: sortDate ?? localDateOf(job.createdAt),
      sortTime,
    });
  }
  return rows.sort((a, b) => b.sortDate.localeCompare(a.sortDate) || b.sortTime.localeCompare(a.sortTime));
}

export type Filter = 'all' | JobStatus;
export const FILTERS: readonly Filter[] = ['all', 'saved', 'applied', 'oa', 'offer'];

/** With an account picked, a view is about that account's own application rather than the whole job. */
function matchesFilter(row: JobRow, filter: Filter, accountId: Id | null): boolean {
  if (accountId !== null) {
    const application = row.applications.find((a) => a.accountId === accountId);
    if (!application) return false;
    if (filter === 'all') return true;
    return filter !== 'saved' && application.stage === filter && !application.rejected;
  }
  if (filter === 'all') return true;
  // Stage filters mean "live at this stage": fully rejected jobs only appear under All.
  return row.status === filter && !row.rejected;
}

export interface RowQuery {
  query: string;
  hideRejected: boolean;
  accounts: readonly Account[];
}

/** Applies search and the rejected toggle — everything except the stage filter, so counts can be shown per filter. */
export function searchRows(rows: readonly JobRow[], { query, hideRejected, accounts }: RowQuery): JobRow[] {
  const needle = query.trim().toLowerCase();
  const accountsById = indexBy(accounts, (a) => a.id);
  return rows.filter((row) => {
    if (hideRejected && row.rejected) return false;
    if (!needle) return true;
    const haystack = [
      row.company.name,
      row.job.title ?? '',
      row.job.notes,
      ...row.applications.flatMap((app) => {
        const account = accountsById.get(app.accountId);
        return account ? [account.label, account.email] : [];
      }),
    ]
      .join('\n')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function filterRows(rows: readonly JobRow[], filter: Filter, accountId: Id | null = null): JobRow[] {
  return rows.filter((row) => matchesFilter(row, filter, accountId));
}

export function countByFilter(rows: readonly JobRow[], accountId: Id | null = null): Record<Filter, number> {
  const counts: Record<Filter, number> = { all: 0, saved: 0, applied: 0, oa: 0, offer: 0 };
  for (const row of rows) {
    for (const filter of FILTERS) if (matchesFilter(row, filter, accountId)) counts[filter] += 1;
  }
  return counts;
}

/** How many jobs each account has applied to. An account applies to a job at most once. */
export function countByAccount(rows: readonly JobRow[]): Map<Id, number> {
  const counts = new Map<Id, number>();
  for (const row of rows) {
    for (const { accountId } of row.applications) counts.set(accountId, (counts.get(accountId) ?? 0) + 1);
  }
  return counts;
}

export interface RowGroup {
  key: GroupKey;
  rows: JobRow[];
}

/** Splits already-sorted rows into date sections, preserving order. */
export function groupRows(rows: readonly JobRow[], today: IsoDate): RowGroup[] {
  const groups: RowGroup[] = [];
  for (const row of rows) {
    const key = groupKeyFor(row.sortDate, today);
    const last = groups.at(-1);
    if (last?.key === key) last.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups;
}

export interface Stats {
  today: number;
  week: number;
  oa: number;
  offer: number;
}

/** Counts applications (not jobs): one posting applied to from two accounts is two applications. */
export function computeStats(applications: readonly Application[], today: IsoDate): Stats {
  const weekStart = startOfWeek(today);
  const stats: Stats = { today: 0, week: 0, oa: 0, offer: 0 };
  for (const app of applications) {
    if (app.appliedAt === today) stats.today += 1;
    if (app.appliedAt >= weekStart && app.appliedAt <= today) stats.week += 1;
    if (!app.rejected && app.stage === 'oa') stats.oa += 1;
    if (!app.rejected && app.stage === 'offer') stats.offer += 1;
  }
  return stats;
}
