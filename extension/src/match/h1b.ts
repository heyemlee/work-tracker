import { normalizeCompanyName } from '@domain/companies';

/**
 * H-1B approvals per employer, built from the USCIS H-1B Employer Data Hub by scripts/build-h1b.mjs and shipped
 * with the extension as public/h1b.json.
 */
export interface H1bTable {
  /** Fiscal years the counts cover, e.g. [2023, 2024, 2025]. */
  years: number[];
  /** Normalized employer name → [approvals over those years, the employer's name as filed]. */
  employers: Record<string, [number, string]>;
}

export interface H1bRecord {
  approvals: number;
  employer: string;
  years: number[];
}

/** Words that name a legal entity rather than the company: "Stripe, Inc." and "Stripe" are one employer. */
const ENTITY =
  /\b(inc|incorporated|llc|l l c|ltd|limited|corp|corporation|co|company|lp|llp|plc|pbc|holdings?|group|technologies|technology|usa|us|america)\b/g;

export function employerKey(name: string): string {
  return normalizeCompanyName(name).replace(ENTITY, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The employer a company's name refers to: an exact key match, else the largest filer whose name starts with the
 * company's ("Meta" → "Meta Platforms"). Null when the company has no filings on record.
 */
export function findEmployer(table: H1bTable, company: string): H1bRecord | null {
  const key = employerKey(company);
  if (!key) return null;
  const exact = table.employers[key];
  if (exact) return { approvals: exact[0], employer: exact[1], years: table.years };
  let best: [number, string] | null = null;
  for (const [name, entry] of Object.entries(table.employers)) {
    if ((name.startsWith(`${key} `) || name === key) && (!best || entry[0] > best[0])) best = entry;
  }
  return best ? { approvals: best[0], employer: best[1], years: table.years } : null;
}
