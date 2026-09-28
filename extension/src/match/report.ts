import { normalizeCompanyName } from '@domain/companies';
import { addDays } from '@domain/dates';
import type { Snapshot } from '@domain/types';
import type { Posting } from '../model';
import { findEmployer, type H1bRecord, type H1bTable } from './h1b';
import { scanPosting, type Level, type Signal } from './scan';

export interface MatchReport {
  level: Level;
  signals: Signal[];
  h1b: H1bRecord | null;
}

const rank: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

/** Postings at this company applied to in the last 30 days, other than this one. */
export function recentAtCompany(
  snapshot: Snapshot,
  company: string,
  today: string,
  exceptJobId: string | null,
): number {
  const target = normalizeCompanyName(company);
  const companyIds = new Set(
    snapshot.companies.filter((item) => normalizeCompanyName(item.name) === target).map((item) => item.id),
  );
  const since = addDays(today, -30);
  const jobs = new Set(
    snapshot.applications
      .filter((application) => application.appliedAt >= since)
      .map((application) => application.jobId)
      .filter((jobId) => jobId !== exceptJobId),
  );
  return snapshot.jobs.filter((job) => companyIds.has(job.companyId) && jobs.has(job.id)).length;
}

export function matchReport(input: {
  posting: Posting;
  applicantYears: number;
  snapshot: Snapshot | null;
  h1b: H1bTable | null;
  today: string;
  jobId: string | null;
  sameCompanyLimit: number;
}): MatchReport {
  const { posting } = input;
  const signals = scanPosting(posting.description, posting.title, input.applicantYears);

  if (input.snapshot && posting.company) {
    const recent = recentAtCompany(input.snapshot, posting.company, input.today, input.jobId);
    if (recent >= input.sameCompanyLimit)
      signals.push({ level: 'yellow', code: 'sameCompany', evidence: String(recent) });
  }

  let h1b: H1bRecord | null = null;
  if (input.h1b && posting.company) {
    h1b = findEmployer(input.h1b, posting.company);
    signals.push(
      h1b && h1b.approvals > 0
        ? { level: 'green', code: 'h1b', evidence: String(h1b.approvals) }
        : { level: 'yellow', code: 'noH1b', evidence: posting.company },
    );
  }

  const level = signals.reduce<Level>(
    (worst, signal) => (rank[signal.level] > rank[worst] ? signal.level : worst),
    'green',
  );
  return { level, signals: [...signals].sort((a, b) => rank[b.level] - rank[a.level]), h1b };
}
