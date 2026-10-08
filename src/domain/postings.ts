import { findJob, normalizeCompanyName } from './companies';
import type { JobRow } from './rows';
import type { Company } from './types';

/** What a pasted job link tells us. */
export interface Posting {
  /** The link as it's stored: see cleanLink. */
  url: string;
  /** How the link names the company — an applicant-tracking board or the site's domain. Null for job boards. */
  companySlug: string | null;
  /** Only Workday links carry a readable title. */
  title: string | null;
}

// Parameters that record where a click came from, not which posting it is.
const TRACKING_PARAMS = new Set([
  'gh_src',
  'lever-source',
  'lever-origin',
  'source',
  'src',
  'ref',
  'referrer',
  'trk',
  'trkinfo',
  'refid',
  'trackingid',
  'gclid',
  'fbclid',
]);

/** Applicant-tracking systems whose links name the company in the first path segment. */
const PATH_BOARDS = new Set([
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'boards.eu.greenhouse.io',
  'job-boards.eu.greenhouse.io',
  'jobs.lever.co',
  'jobs.eu.lever.co',
  'jobs.ashbyhq.com',
  'jobs.gem.com',
  'jobs.smartrecruiters.com',
  'apply.workable.com',
  'jobs.jobvite.com',
  'ats.rippling.com',
]);

/** Applicant-tracking systems — and Notion, where startups often post roles — that give each company a subdomain. */
const SUBDOMAIN_BOARDS = [
  'myworkdayjobs.com',
  'icims.com',
  'bamboohr.com',
  'recruitee.com',
  'breezy.hr',
  'notion.site',
];

/** Sites that list other companies' postings: their domain says nothing about the company. */
const JOB_BOARDS = [
  'linkedin.com',
  'lnkd.in',
  'indeed.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'wellfound.com',
  'dice.com',
  'monster.com',
  'simplyhired.com',
  'joinhandshake.com',
  'builtin.com',
  'jobright.ai',
  'simplify.jobs',
  'workatastartup.com',
  'ycombinator.com',
  'hired.com',
  'welcometothejungle.com',
];

/** Career sites whose domain isn't the company's name. */
const DOMAIN_ALIASES: Record<string, string> = { metacareers: 'meta', lifeattiktok: 'tiktok' };

const isUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/**
 * A link as it's stored: http(s) only, without the fragment or tracking parameters. A bare domain gets
 * `https://`. Null if the text isn't a web link.
 */
export function cleanLink(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) return null;

  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) url.searchParams.delete(key);
  }
  // A form that submits to its own page leaves a bare "?": the same posting.
  if (url.searchParams.size === 0) url.search = '';
  // A LinkedIn search result names the posting it has open; keep just that posting.
  const linkedInJob = url.searchParams.get('currentJobId');
  if (isUnder(url.hostname, 'linkedin.com') && linkedInJob) {
    return `https://www.linkedin.com/jobs/view/${encodeURIComponent(linkedInJob)}/`;
  }
  return url.toString();
}

/** Reads a pasted job link. Null unless the text is a single http(s) link. */
export function parsePosting(text: string): Posting | null {
  if (!/^https?:\/\//i.test(text.trim())) return null;
  const cleaned = cleanLink(text);
  if (!cleaned) return null;
  const url = new URL(cleaned);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  return { url: cleaned, companySlug: companySlug(host, segments, url), title: workdayTitle(host, segments) };
}

function companySlug(host: string, segments: string[], url: URL): string | null {
  if (PATH_BOARDS.has(host)) {
    // Greenhouse's embedded form names the board in a parameter: /embed/job_app?for=acme&token=123
    if (segments[0] === 'embed') return url.searchParams.get('for');
    return segments[0] ?? null;
  }
  if (isUnder(host, 'myworkdaysite.com')) {
    return segments[0] === 'recruiting' ? (segments[1] ?? null) : null;
  }
  const board = SUBDOMAIN_BOARDS.find((domain) => host.endsWith(`.${domain}`));
  if (board) {
    const label = host.split('.')[0] ?? '';
    return label.replace(/^(us)?(careers|jobs)-/, '') || null;
  }
  if (JOB_BOARDS.some((domain) => isUnder(host, domain))) return null;

  // Anything else is taken to be the company's own site: careers.acme.com, acme.jobs, jobs.acme.co.uk.
  const labels = host.split('.');
  const suffixLength = /\.(co|com|org|net|ac)\.[a-z]{2}$/.test(host) ? 2 : 1;
  const label = labels[labels.length - 1 - suffixLength];
  if (!label) return null;
  return DOMAIN_ALIASES[label] ?? label;
}

/** /en-US/External/job/Santa-Clara-CA/Senior-Software-Engineer_JR2001234 → "Senior Software Engineer" */
function workdayTitle(host: string, segments: string[]): string | null {
  if (!isUnder(host, 'myworkdayjobs.com') && !isUnder(host, 'myworkdaysite.com')) return null;
  if (!segments.some((segment) => segment === 'job' || segment === 'details')) return null;
  const match = /^(.+)_[A-Za-z0-9-]+$/.exec(segments[segments.length - 1] ?? '');
  const title = match?.[1]?.replace(/-+/g, ' ').trim();
  return title || null;
}

const squash = (name: string) => normalizeCompanyName(name).replaceAll(' ', '');

/**
 * The company a link's slug names: an existing company when one matches ("scale-ai" → "Scale AI"), otherwise the
 * slug with each word capitalized.
 */
export function companyFromSlug(slug: string, companies: readonly Company[]): string {
  const words = slug.split(/[-_.\s]+/).filter(Boolean);
  const key = squash(words.join(' '));
  const existing = key ? companies.find((company) => squash(company.name) === key) : undefined;
  if (existing) return existing.name;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/** Two links to the same posting compare equal: no scheme, www, trailing slash, or parameter order. */
export function linkKey(url: string): string {
  const cleaned = cleanLink(url);
  if (!cleaned) return url.trim();
  const parsed = new URL(cleaned);
  parsed.searchParams.sort();
  const host = parsed.hostname.replace(/^www\./, '');
  return `${host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
}

/** The tracked job with this link, if any. */
export function findJobByLink(rows: readonly JobRow[], url: string): JobRow | undefined {
  const key = linkKey(url);
  return rows.find((row) => row.job.url !== null && linkKey(row.job.url) === key);
}

/**
 * The tracked job a new entry is: same company and title (see findJob) — unless both have links and they
 * differ, as with two "Software Engineer" postings in different cities.
 */
export function findSamePosting(
  rows: readonly JobRow[],
  companyName: string,
  title: string | null,
  url: string | null,
): JobRow | undefined {
  if (!url) return findJob(rows, companyName, title);
  const key = linkKey(url);
  return findJob(
    rows.filter((row) => row.job.url === null || linkKey(row.job.url) === key),
    companyName,
    title,
  );
}

/** The link without its scheme or www, for display: "job-boards.greenhouse.io/acme/jobs/123". */
export function displayLink(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${path}${parsed.search}`;
  } catch {
    return url;
  }
}
