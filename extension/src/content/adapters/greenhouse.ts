import { cleanLink, companyFromSlug, parsePosting } from '@domain/postings';
import type { FieldKind, Hint, Posting } from '../../model';
import { htmlText, jsonAfter, textOf } from '../dom';
import type { Adapter } from './types';

const HINTS: Record<string, Hint> = {
  first_name: 'name.first',
  last_name: 'name.last',
  preferred_name: 'name.preferred',
  email: 'email',
  phone: 'phone',
  country: 'phone.country',
  'candidate-location': 'location',
  resume: 'resume',
  cover_letter: 'coverLetter',
  gender: 'eeo.gender',
  hispanic_ethnicity: 'eeo.hispanic',
  race: 'eeo.race',
  veteran_status: 'eeo.veteran',
  disability_status: 'eeo.disability',
};

/** The education section's dates, numbered per school: "start-month--0", "end-year--1". */
const EDUCATION = /^(start-month|start-year|end-month|end-year)--(\d+)$/;

const EDUCATION_HINTS: Record<string, Hint> = {
  'start-month': 'education.start',
  'start-year': 'education.start',
  'end-month': 'education.end',
  'end-year': 'education.end',
};

/** "Job Application for Software Engineer at Stripe" → ["Software Engineer", "Stripe"]. */
function fromTitle(doc: Document): { title: string | null; company: string | null } {
  const match = /^Job Application for (.+) at (.+)$/.exec(doc.title.trim());
  return { title: match?.[1]?.trim() ?? null, company: match?.[2]?.trim() ?? null };
}

/** The job board's own link for a posting, including the embedded form's `?for=stripe&token=123`. */
function boardLink(url: string): string {
  const parsed = new URL(url);
  if (parsed.pathname.startsWith('/embed/job_app')) {
    const board = parsed.searchParams.get('for');
    const token = parsed.searchParams.get('token');
    if (board && token) return `https://job-boards.greenhouse.io/${board}/jobs/${token}`;
  }
  parsed.pathname = parsed.pathname.replace(/\/confirmation\/?$/, '');
  return cleanLink(parsed.toString()) ?? url;
}

interface JobData {
  title?: string;
  company_name?: string;
  job_post_location?: string;
  content?: string;
}

/**
 * The job the page was rendered from. An embedded form shows no title, location or description, but the page's
 * inline data still carries them.
 */
function jobData(doc: Document): JobData | null {
  for (const script of doc.querySelectorAll('script:not([src])')) {
    const context = jsonAfter(script.textContent ?? '', 'window.__remixContext') as {
      state?: { loaderData?: Record<string, { jobPost?: JobData } | null> };
    } | null;
    if (context)
      return Object.values(context.state?.loaderData ?? {}).find((data) => data?.jobPost)?.jobPost ?? null;
  }
  return null;
}

export const greenhouse: Adapter = {
  ats: 'greenhouse',

  form: (doc) =>
    doc.querySelector('form#application-form, form.application--form, form#application_form') ??
    doc.querySelector('#first_name')?.closest('form') ??
    null,

  posting(doc, url): Posting {
    const titled = fromTitle(doc);
    const link = boardLink(url);
    const slug = parsePosting(link)?.companySlug ?? null;
    const job = jobData(doc);
    return {
      ats: 'greenhouse',
      title:
        textOf(doc.querySelector('.job__title h1, h1.app-title, .app-title')) ||
        titled.title ||
        job?.title ||
        null,
      company:
        titled.company ??
        (textOf(doc.querySelector('.company-name')).replace(/^at\s+/i, '') ||
          job?.company_name ||
          (slug ? companyFromSlug(slug, []) : null)),
      url: link,
      location: textOf(doc.querySelector('.job__location, .location')) || job?.job_post_location || null,
      description: (textOf(doc.querySelector('.job__description, #content')) || htmlText(job?.content)).slice(
        0,
        8000,
      ),
    };
  },

  hint: (control) => HINTS[control.id] ?? EDUCATION_HINTS[EDUCATION.exec(control.id)?.[1] ?? ''] ?? null,

  // A school's dates are that school's, not "when can you start".
  entry(control) {
    const match = EDUCATION.exec(control.id);
    return match ? { kind: 'education', index: Number(match[2]) } : null;
  },

  kind(control): FieldKind | null {
    // The city field searches as you type; the rest of react-select's comboboxes are plain choices.
    if (control.id === 'candidate-location') return 'typeahead';
    return null;
  },

  // "Enter manually" text boxes duplicate the resume and cover letter uploads.
  skip: (control) => /^(resume|cover_letter)_text$/.test(control.id),

  submitButton: (doc) =>
    doc.querySelector<HTMLElement>(
      '.application--submit button[type="submit"], #submit_app, form#application-form button[type="submit"]',
    ),

  confirmed(doc, url) {
    if (/\/confirmation\/?(\?|$)/.test(new URL(url).pathname + new URL(url).search)) return true;
    const main = doc.querySelector('main, #application, .application--container, body');
    return /thank you for applying|thanks for applying|application (has been |was )?(received|submitted)|we('ve| have) received your application/i.test(
      textOf(main).slice(0, 3000),
    );
  },
};
