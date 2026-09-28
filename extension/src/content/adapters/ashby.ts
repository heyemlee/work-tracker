import { cleanLink } from '@domain/postings';
import type { FieldKind, Hint, Posting } from '../../model';
import { htmlText, jsonAfter, textOf } from '../dom';
import type { Adapter, CustomField } from './types';

const PATH_HINTS: Record<string, Hint> = {
  _systemfield_name: 'name.full',
  _systemfield_email: 'email',
  _systemfield_resume: 'resume',
  _systemfield_location: 'location',
  _systemfield_eeoc_gender: 'eeo.gender',
  _systemfield_eeoc_race: 'eeo.race',
  _systemfield_eeoc_veteran_status: 'eeo.veteran',
  _systemfield_eeoc_disability_status: 'eeo.disability',
};

const pathOf = (element: Element) =>
  element.closest('[data-field-path]')?.getAttribute('data-field-path') ?? '';

interface AppData {
  posting?: {
    title?: string;
    locationName?: string;
    descriptionPlainText?: string;
    descriptionHtml?: string;
  };
  organization?: { name?: string };
}

/** Ashby renders in the browser from `window.__appData`, which the page ships as a script the content script can read. */
function appData(doc: Document): AppData | null {
  for (const script of doc.querySelectorAll('script')) {
    const data = jsonAfter(script.textContent ?? '', 'window.__appData');
    if (data) return data as AppData;
  }
  return null;
}

export const ashby: Adapter = {
  ats: 'ashby',

  form: (doc) =>
    doc.querySelector('.ashby-application-form-container')?.closest('#form, [role="tabpanel"]') ?? null,

  posting(doc, url): Posting {
    const data = appData(doc);
    // "Software Engineer @ Notion".
    const [titlePart, companyPart] = doc.title.split(' @ ');
    const link = new URL(url);
    link.pathname = link.pathname.replace(/\/application\/?$/, '');
    const description =
      data?.posting?.descriptionPlainText ||
      htmlText(data?.posting?.descriptionHtml) ||
      textOf(doc.querySelector('.ashby-job-posting-description, [class*="descriptionText"]'));
    return {
      ats: 'ashby',
      title:
        textOf(doc.querySelector('h1.ashby-job-posting-heading, h1')) ||
        titlePart?.trim() ||
        data?.posting?.title ||
        null,
      company: companyPart?.trim() || data?.organization?.name || null,
      url: cleanLink(link.toString()) ?? url,
      location: data?.posting?.locationName ?? null,
      description: description.slice(0, 8000),
    };
  },

  hint: (control) => PATH_HINTS[pathOf(control)] ?? null,

  kind: (control): FieldKind | null =>
    control.matches('.ashby-application-form-input-autocomplete') ? 'typeahead' : null,

  skip: (control) =>
    // "Autofill from resume" uploads to Ashby's parser, not the application; yes/no buttons hide a checkbox.
    Boolean(
      control.closest('.ashby-application-form-autofill-uploader, .ashby-application-form-input-yesno'),
    ),

  custom(form): CustomField[] {
    return [...form.querySelectorAll<HTMLElement>('.ashby-application-form-input-yesno')].map((group) => {
      const entry = group.closest('[data-field-path]') ?? group.parentElement ?? group;
      const title = entry.querySelector('.ashby-application-form-question-title');
      const buttons = [...group.querySelectorAll<HTMLElement>('button[data-option]')];
      return {
        label: textOf(title),
        kind: 'radio',
        options: buttons.map((button) => textOf(button)),
        required: Boolean(title?.className.includes('_required')),
        hint: PATH_HINTS[pathOf(group)] ?? null,
        handle: { type: 'buttons', buttons },
        anchor: entry,
      };
    });
  },

  submitButton: (doc) => doc.querySelector<HTMLElement>('.ashby-application-form-submit-button'),

  confirmed(doc) {
    const success = doc.querySelector('[class*="success"], .ashby-application-form-success-container');
    const text = textOf(success ?? doc.body).slice(0, 3000);
    return (
      /thank you for applying|thanks for applying|application (was |has been )?(submitted|received)|successfully submitted/i.test(
        text,
      ) && !doc.querySelector('.ashby-application-form-submit-button')
    );
  },
};
