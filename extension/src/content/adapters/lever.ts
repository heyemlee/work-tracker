import { cleanLink } from '@domain/postings';
import type { FieldKind, Hint, Posting } from '../../model';
import { textOf } from '../dom';
import type { Adapter } from './types';

const NAME_HINTS: Record<string, Hint> = {
  name: 'name.full',
  email: 'email',
  phone: 'phone',
  location: 'location',
  org: 'current.company',
  'urls[LinkedIn]': 'links.linkedin',
  'urls[GitHub]': 'links.github',
  'urls[Portfolio]': 'links.website',
  'urls[Other]': 'links.website',
  'urls[Twitter]': 'links.twitter',
  resume: 'resume',
  pronouns: 'pronouns',
  'eeo[gender]': 'eeo.gender',
  'eeo[race]': 'eeo.race',
  'eeo[veteran]': 'eeo.veteran',
  'eeo[disability]': 'eeo.disability',
};

export const lever: Adapter = {
  ats: 'lever',

  form: (doc) => doc.querySelector('form#application-form, form.application-form'),

  posting(doc, url): Posting {
    // "Spotify - Senior Backend Engineer - Subscriptions".
    const [companyPart, ...rest] = doc.title.split(' - ');
    const link = new URL(url);
    link.pathname = link.pathname.replace(/\/(apply|thanks)\/?$/, '');
    return {
      ats: 'lever',
      title:
        textOf(doc.querySelector('.posting-header h2, .posting-headline h2')) ||
        rest.join(' - ').trim() ||
        null,
      company: companyPart?.trim() || null,
      url: cleanLink(link.toString()) ?? url,
      location: textOf(doc.querySelector('.posting-categories .location')) || null,
      description: textOf(
        doc.querySelector(
          '.posting-page .section-wrapper .section.page-centered, [data-qa="job-description"]',
        ),
      ).slice(0, 8000),
    };
  },

  hint: (control) => NAME_HINTS[control.getAttribute('name') ?? ''] ?? null,

  kind: (control): FieldKind | null =>
    control.matches('.location-input, #location-input') ? 'typeahead' : null,

  submitButton: (doc) => doc.querySelector<HTMLElement>('#btn-submit, button[data-qa="btn-submit"]'),

  confirmed(doc, url) {
    if (/\/thanks\/?$/.test(new URL(url).pathname)) return true;
    return /thank you for applying|thanks for applying|application (was |has been )?(submitted|received)/i.test(
      textOf(doc.querySelector('.content, main, body')).slice(0, 3000),
    );
  },
};
