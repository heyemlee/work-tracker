import { groupBy, indexBy } from './collections';
import { groupKeyFor, localDateOf, type GroupKey } from './dates';
import { rollup } from './stages';
import type { Account, Application, Company, IsoDate, IsoDateTime, Job, JobStatus, Snapshot } from './types';

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

function matchesFilter(row: JobRow, filter: Filter): boolean {
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

export function filterRows(rows: readonly JobRow[], filter: Filter): JobRow[] {
  return rows.filter((row) => matchesFilter(row, filter));
}

export function countByFilter(rows: readonly JobRow[]): Record<Filter, number> {
  const counts: Record<Filter, number> = { all: 0, saved: 0, applied: 0, oa: 0, offer: 0 };
  for (const row of rows) {
    for (const filter of FILTERS) if (matchesFilter(row, filter)) counts[filter] += 1;
  }
  return counts;
}

export interface RowGroup {
  key: GroupKey;
  rows: JobRow[];
  /** How many jobs the section holds in all: more than `rows` on a page that shows part of it. */
  total: number;
}

/** Splits already-sorted rows into date sections, preserving order. */
export function groupRows(rows: readonly JobRow[], today: IsoDate): RowGroup[] {
  const groups: RowGroup[] = [];
  for (const row of rows) {
    const key = groupKeyFor(row.sortDate, today);
    const last = groups.at(-1);
    if (last?.key === key) {
      last.rows.push(row);
      last.total += 1;
    } else groups.push({ key, rows: [row], total: 1 });
  }
  return groups;
}

/** Jobs on one page of the list: about a day's applications, so the page is as long after a year as after a week. */
export const PAGE_SIZE = 25;

export interface RowPage {
  groups: RowGroup[];
  /** Zero-based. The last page, when a later one was asked for. */
  page: number;
  pages: number;
}

/** One page of the sections. A section the page cuts shows again on the next one, with its whole count on both. */
export function pageGroups(groups: readonly RowGroup[], page: number, size = PAGE_SIZE): RowPage {
  const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const pages = Math.ceil(count / size);
  const shown = Math.min(Math.max(page, 0), Math.max(pages - 1, 0));

  const cut: RowGroup[] = [];
  let skip = shown * size;
  let room = size;
  for (const group of groups) {
    if (room === 0) break;
    if (skip >= group.rows.length) {
      skip -= group.rows.length;
      continue;
    }
    const rows = group.rows.slice(skip, skip + room);
    cut.push({ ...group, rows });
    skip = 0;
    room -= rows.length;
  }
  return { groups: cut, page: shown, pages };
}
