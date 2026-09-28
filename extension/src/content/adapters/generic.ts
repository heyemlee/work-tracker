import { cleanLink, companyFromSlug, parsePosting } from '@domain/postings';
import type { Posting } from '../../model';
import { clean } from '../../text';
import { textOf } from '../dom';
import type { Adapter } from './types';

const meta = (doc: Document, property: string) =>
  clean(
    doc.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.getAttribute('content') ??
      '',
  );

/** The form with the most fields that look like an application: name, email, resume. */
function applicationForm(doc: Document): Element | null {
  let best: Element | null = null;
  let bestScore = 0;
  for (const form of doc.querySelectorAll('form')) {
    const text = [...form.querySelectorAll('input, textarea, select, label')]
      .map(
        (element) =>
          `${element.getAttribute('name') ?? ''} ${element.getAttribute('id') ?? ''} ${textOf(element)}`,
      )
      .join(' ')
      .toLowerCase();
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

/** Any other site: the card opens from the toolbar and the field dictionary does what it can. */
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
