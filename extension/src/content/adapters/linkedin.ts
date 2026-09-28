import { cleanLink } from '@domain/postings';
import type { Posting } from '../../model';
import { textOf } from '../dom';
import type { Adapter } from './types';

const first = (doc: Document, selectors: string[]) => {
  for (const selector of selectors) {
    const text = textOf(doc.querySelector(selector));
    if (text) return text;
  }
  return '';
};

/**
 * LinkedIn's terms forbid automating it, so there's no form here: the card only reads the posting the owner is
 * looking at, to log it to Outbox on request. Its class names change often, hence the fallbacks.
 */
export const linkedin: Adapter = {
  ats: 'linkedin',

  form: () => null,

  posting(doc, url): Posting | null {
    const title = first(doc, [
      '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title',
      '.top-card-layout__title',
      'h1',
    ]);
    if (!title) return null;
    return {
      ats: 'linkedin',
      title,
      company:
        first(doc, [
          '.job-details-jobs-unified-top-card__company-name',
          '.jobs-unified-top-card__company-name',
          '.topcard__org-name-link',
          '.top-card-layout__second-subline a',
        ]) || null,
      // A search page names the open posting in ?currentJobId; cleanLink turns it into the posting's own page.
      url: cleanLink(url) ?? url,
      location:
        first(doc, [
          '.job-details-jobs-unified-top-card__primary-description-container span',
          '.topcard__flavor--bullet',
        ]) || null,
      description: first(doc, ['#job-details', '.jobs-description__content', '.description__text']).slice(
        0,
        8000,
      ),
    };
  },

  submitButton: () => null,

  confirmed: () => false,
};
