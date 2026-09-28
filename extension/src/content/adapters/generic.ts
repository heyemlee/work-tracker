import { cleanLink, companyFromSlug, parsePosting } from '@domain/postings';
import type { Posting } from '../../model';
import { clean } from '../../text';
import { isHidden, textOf } from '../dom';
import type { Adapter } from './types';

const meta = (doc: Document, property: string) =>
  clean(
    doc.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.getAttribute('content') ??
      '',
  );

/** What the controls in `root` say about themselves, lowercased: their names, ids and labels. */
function fieldText(root: Element): string {
  return [...root.querySelectorAll('input, textarea, select, label')]
    .map(
      (element) =>
        `${element.getAttribute('name') ?? ''} ${element.getAttribute('id') ?? ''} ${textOf(element)}`,
    )
    .join(' ')
    .toLowerCase();
}

/** A name or an email field. */
const PERSON = /first.?name|last.?name|full.?name|\bname\b|e-?mail/;
const RESUME = /r[eé]sum[eé]|\bcv\b|curriculum/i;
/** Addresses of job pages: careers.acme.com, acme.com/jobs/123, …/apply, Greenhouse's gh_jid. */
const JOB_ADDRESS =
  /job|career|apply|applica|position|opening|recruit|talent|hiring|vacanc|candidate|gh_jid/i;

/** The form with the most fields that look like an application: name, email, resume. */
function bestForm(doc: Document): Element | null {
  let best: Element | null = null;
  let bestScore = 0;
  for (const form of doc.querySelectorAll('form')) {
    const text = fieldText(form);
    let score = form.querySelectorAll('input:not([type="hidden"]), textarea, select').length;
    if (/first.?name|full.?name|last.?name/.test(text)) score += 10;
    if (/e-?mail/.test(text)) score += 5;
    if (/resume|cv\b|curriculum/.test(text)) score += 10;
    if (form.querySelectorAll('input[type="password"]').length && score < 20) score = 0;
    if (score > bestScore) {
      best = form;
      bestScore = score;
    }
  }
  return bestScore >= 15 ? best : null;
}

/**
 * A page drawn without a <form>, as React apps like Ashby's are: the closest element around a file upload that also
 * holds a name or email field.
 */
function formlessForm(doc: Document): Element | null {
  for (const upload of doc.querySelectorAll('input[type="file"]')) {
    let node = upload.parentElement;
    for (let depth = 0; node && node !== doc.body && depth < 12; depth++, node = node.parentElement) {
      const controls = node.querySelectorAll('input:not([type="hidden"]), textarea, select').length;
      if (controls >= 3 && PERSON.test(fieldText(node))) return node;
    }
  }
  return null;
}

function applicationForm(doc: Document): Element | null {
  return bestForm(doc) ?? formlessForm(doc);
}

/**
 * An application form on show, with a resume upload and a name or email field: what opens the card by itself on a
 * site the extension doesn't know. A contact form has no resume to upload; a sign-in page is no application form.
 * Pages drawn without a <form> count only at a job address, so apps with an upload somewhere (mail, chat, drives)
 * aren't searched as they change.
 */
export function resumeForm(doc: Document): Element | null {
  if (!doc.querySelector('input[type="file"]')) return null;
  const form = bestForm(doc) ?? (JOB_ADDRESS.test(doc.URL) ? formlessForm(doc) : null);
  if (!form?.querySelector('input[type="file"]') || isHidden(form)) return null;
  const fields = fieldText(form);
  return PERSON.test(fields) && RESUME.test(`${fields} ${textOf(form)}`) ? form : null;
}

/**
 * Any other site: the card opens by itself on a form with a resume upload (see `resumeForm`), or from the toolbar, and
 * the field dictionary does what it can.
 */
export const generic: Adapter = {
  ats: 'generic',

  form: (doc) => applicationForm(doc),

  posting(doc, url): Posting {
    const parsed = parsePosting(url);
    const title = meta(doc, 'og:title') || textOf(doc.querySelector('h1')) || clean(doc.title);
    const company =
      meta(doc, 'og:site_name') || (parsed?.companySlug ? companyFromSlug(parsed.companySlug, []) : null);
    return {
      ats: 'generic',
      title: title || null,
      company: company || null,
      url: cleanLink(url) ?? url,
      location: null,
      description: textOf(doc.querySelector('main, article, [role="main"]')).slice(0, 8000),
    };
  },

  submitButton: (doc) =>
    applicationForm(doc)?.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]') ?? null,

  confirmed(doc) {
    return /thank you for (applying|your application)|application (was |has been )?(submitted|received)|we('ve| have) received your application/i.test(
      textOf(doc.querySelector('main, body')).slice(0, 3000),
    );
  },
};
