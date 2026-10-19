import { cleanLink } from '@domain/postings';
import type { Posting } from '../../model';
import { clean } from '../../text';
import { textOf, wordsAt } from '../dom';
import type { Adapter } from './types';

/** A job's key on Indeed: sixteen hex digits, in `jk`, `vjk` or `fromjk`. */
const JOB_KEY = /^[0-9a-f]{16}$/;

const first = (doc: Document, selectors: string[]) => {
  for (const selector of selectors) {
    const text = textOf(doc.querySelector(selector));
    if (text) return text;
  }
  return '';
};

/** What a job's own page says of the posting for search engines: schema.org's JobPosting, in JSON-LD. */
interface JobPostingMarkup {
  '@type'?: string | string[];
  title?: string;
  description?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: Place | Place[];
}
interface Place {
  address?: { addressLocality?: string; addressRegion?: string };
}

/** The posting as its markup tells it, for a page drawn otherwise than the header below expects. */
function markedUp(doc: Document): {
  title?: string;
  company?: string;
  location?: string;
  description?: string;
} {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let data: JobPostingMarkup | null;
    try {
      data = JSON.parse(script.textContent ?? '') as JobPostingMarkup | null;
    } catch {
      continue;
    }
    if (!data || ![data['@type']].flat().includes('JobPosting')) continue;
    const address = [data.jobLocation].flat()[0]?.address;
    // The description is markup: read in a document of its own, where nothing it holds loads or runs.
    const description = new DOMParser().parseFromString(String(data.description ?? ''), 'text/html').body;
    return {
      title: clean(String(data.title ?? '')),
      company: clean(String(data.hiringOrganization?.name ?? '')),
      location: [address?.addressLocality, address?.addressRegion].filter(Boolean).join(', '),
      description: textOf(description),
    };
  }
  return {};
}

/**
 * Where the job is: the header's first line of words after the company's (a link to its page on Indeed, or plain
 * text for a company without one), past its rating and the dots between them.
 */
function locationIn(doc: Document): string {
  const header = doc.querySelector('[data-testid="company-info-metadata"]');
  for (const line of header?.querySelectorAll('[dir="ltr"]') ?? []) {
    if (line.querySelector('[dir="ltr"]') || line.closest('a, [data-testid="vj-company-name"]')) continue;
    const text = textOf(line);
    if (/\p{L}/u.test(text)) return text;
  }
  return '';
}

/**
 * The job on show, by its key. The header's own link to the company names it, else the job picked in the list
 * beside it, else the address. The address takes the next job's key as soon as it's picked and the header follows a
 * moment later: read from the header first, the key and the title are one job's.
 */
function jobKey(doc: Document, url: string): string | null {
  const address = new URL(url);
  const company = doc.querySelector('[data-testid="company-info-metadata"] a[href*="fromjk="]');
  const keys = [
    company && new URL(company.getAttribute('href')!, url).searchParams.get('fromjk'),
    doc.querySelector('.vjs-highlight a[data-jk], a[data-jk][aria-pressed="true"]')?.getAttribute('data-jk'),
    address.searchParams.get('vjk'),
    address.searchParams.get('jk'),
  ];
  return keys.find((key) => key && JOB_KEY.test(key)) ?? null;
}

/**
 * Indeed's terms forbid automating Indeed Apply ("any automation, scripting, or bots"), so, as on LinkedIn, there's
 * no form here: the card reads the posting the owner is looking at, on its own page or open beside a list of jobs,
 * to log it to Outbox or save it for later. The pages are drawn in React Native for the web, with no class names to
 * go by but test ids; the older header's ids follow.
 */
export const indeed: Adapter = {
  ats: 'indeed',

  form: () => null,

  posting(doc, url): Posting | null {
    const marked = markedUp(doc);
    const title =
      first(doc, ['[data-testid="vj-job-title"]']) ||
      marked.title ||
      first(doc, ['[data-testid="jobsearch-JobInfoHeader-title"]']).replace(/\s*-\s*job post$/i, '');
    if (!title) return null;
    const key = jobKey(doc, url);
    const page = key ? `${new URL(url).origin}/viewjob?jk=${key}` : url;
    return {
      ats: 'indeed',
      title,
      company:
        first(doc, [
          '[data-testid="company-info-metadata"] [data-testid="vj-company-name"]',
          '[data-testid="company-info-metadata"] a[href*="/cmp/"]',
        ]) ||
        marked.company ||
        first(doc, ['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]']) ||
        null,
      url: cleanLink(page) ?? page,
      location:
        locationIn(doc) ||
        marked.location ||
        first(doc, ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]']) ||
        null,
      // Its text, not the style sheet Indeed puts inside the description.
      description: (
        wordsAt(doc, ['.react-native-html-content', '#jobDescriptionText'], 8000) ||
        marked.description ||
        ''
      ).slice(0, 8000),
    };
  },

  submitButton: () => null,

  confirmed: () => false,
};
