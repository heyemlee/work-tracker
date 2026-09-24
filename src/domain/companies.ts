import { groupBy } from './collections';
import type { JobRow } from './rows';
import type { Company } from './types';

const LEGAL_SUFFIXES = /\b(inc|llc|ltd|corp|corporation|co|company|gmbh)\b/g;

/** "Stripe, Inc." and "stripe" are the same company. */
export function normalizeCompanyName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTitle(title: string | null): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function findCompany(companies: readonly Company[], name: string): Company | undefined {
  const key = normalizeCompanyName(name);
  return key ? companies.find((c) => normalizeCompanyName(c.name) === key) : undefined;
}

/**
 * The existing job a quick-add refers to: same company and same title. Title-less entries never match — two
 * untitled "Stripe" entries are more likely two postings than one.
 */
export function findJob(
  rows: readonly JobRow[],
  companyName: string,
  title: string | null,
): JobRow | undefined {
  const company = normalizeCompanyName(companyName);
  const normalizedTitle = normalizeTitle(title);
  if (!company || !normalizedTitle) return undefined;
  return rows.find(
    (row) =>
      normalizeCompanyName(row.company.name) === company && normalizeTitle(row.job.title) === normalizedTitle,
  );
}

export interface CompanySuggestion {
  company: Company;
  /** Most recent first. */
  jobs: JobRow[];
}

/** Exact match first, then prefix, then word-prefix, then substring. */
export function suggestCompanies(
  query: string,
  rows: readonly JobRow[],
  companies: readonly Company[],
  limit = 4,
): CompanySuggestion[] {
  const needle = normalizeCompanyName(query);
  if (!needle) return [];
  const rowsByCompany = groupBy(rows, (row) => row.company.id);
  const scored: { company: Company; score: number }[] = [];
  for (const company of companies) {
    const name = normalizeCompanyName(company.name);
    const score =
      name === needle
        ? 0
        : name.startsWith(needle)
          ? 1
          : name.split(' ').some((word) => word.startsWith(needle))
            ? 2
            : name.includes(needle)
              ? 3
              : -1;
    if (score >= 0) scored.push({ company, score });
  }
  scored.sort((a, b) => a.score - b.score || a.company.name.localeCompare(b.company.name));
  return scored
    .slice(0, limit)
    .map(({ company }) => ({ company, jobs: rowsByCompany.get(company.id) ?? [] }));
}
