import { cleanLink } from '@domain/postings';
import type { FieldKind, Hint, Posting } from '../../model';
import { htmlText, jsonAfter, sleep, textOf, waitFor, wordsAt } from '../dom';
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

/** Saves of answers the page has finished, from its network timeline. */
let saves = 0;
let watching = false;

function watchSaves(): void {
  if (watching || typeof PerformanceObserver === 'undefined') return;
  watching = true;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (/[?&]op=ApiSetFormValue/.test(entry.name)) saves++;
  }).observe({ type: 'resource' });
}

/** The page talks to Ashby's API, as the live form does and a saved copy of it doesn't. */
const live = () =>
  performance.getEntriesByType('resource').some((entry) => entry.name.includes('/api/non-user-graphql'));

/**
 * Rules of Ashby's stylesheet that tell of an answer, by being on an element or by being gone from it: a class
 * "_checked_1258i_57" is the rule "checked". A chosen radio and a ticked box are drawn by "checked", a pressed Yes or
 * No by "active", a rating's number by "valueSelected" (and the end of its scale by "labelActive"); a dropdown that
 * still prompts is "placeholder".
 */
const TELLS = /^_(checked|active|valueSelected|labelActive|placeholder)_/;

/** What an upload's button says while its box is empty. Holding a file it says "Replace", or "Add" where it takes several. */
const UPLOAD = { one: 'Upload File', several: 'Upload File(s)' };

/** Gives two lists of the same kind every choice either has. Months climb from January, years fall from next year. */
function shareChoices(one: HTMLSelectElement | undefined, other: HTMLSelectElement | undefined): void {
  if (!one || !other) return;
  const choices = new Map<number, string>();
  for (const option of [...one.options, ...other.options])
    if (option.value) choices.set(Number(option.value), option.text);
  const values = [...choices.keys()].sort((a, b) => a - b);
  // Anything but numbered months or years isn't a date's list: left as it is.
  if (values.some((value) => !Number.isInteger(value))) return;
  if (Math.max(...values) > 12) values.reverse();
  for (const list of [one, other]) {
    for (const option of [...list.options]) if (option.value) option.remove();
    for (const value of values) {
      const option = list.ownerDocument.createElement('option');
      option.value = String(value);
      option.textContent = choices.get(value) ?? '';
      list.append(option);
    }
  }
}

/**
 * Takes the answers out of a copy of the form, for a fill report. Ashby draws them in markup of its own, where
 * emptying the inputs doesn't reach, and each goes back to what Ashby draws for a question still unanswered.
 */
function blank(form: Element): void {
  // A chosen radio, a ticked box, a pressed Yes or No and a rating's number are each drawn by a class, on the
  // control and on what's round it. Every class list is written again without those, so that it reads the same
  // whether one was there or not: Ashby leaves a gap where a class it left out would have stood.
  for (const element of form.querySelectorAll('[class]'))
    element.setAttribute('class', [...element.classList].filter((name) => !TELLS.test(name)).join(' '));
  for (const marked of form.querySelectorAll('[data-checked]')) marked.removeAttribute('data-checked');
  // A radio's row also says in so many words whether it is the chosen one.
  for (const row of form.querySelectorAll('.ashby-application-form-input-radio-group-option'))
    row.classList.replace('true', 'false');
  // A file an upload holds is listed by name over its box, and the button then offers to replace it or add to it.
  for (const box of form.querySelectorAll('.ashby-application-form-input-file')) {
    const held = [...box.querySelectorAll('.ashby-application-form-input-file-item')];
    if (!held.length) continue;
    for (const item of held) item.remove();
    const button = box.querySelector('.ashby-application-form-input-file-dropzone-upload');
    const several = box.querySelector('input[type="file"]')?.hasAttribute('multiple');
    if (button) button.innerHTML = `<span><span>${several ? UPLOAD.several : UPLOAD.one}</span></span>`;
  }
  // A school's two dates bound each other's lists, so that no end comes before its start: the months and years left
  // to choose from in one tell the other. And "Still Student?" shuts the end date.
  const starts = [...form.querySelectorAll('[id$="-startDate"]')];
  const ends = [...form.querySelectorAll('[id$="-endDate"]')];
  if (starts.length === ends.length)
    starts.forEach((start, index) => {
      const [from, to] = [start, ends[index]!].map((date) => [...date.querySelectorAll('select')]);
      for (const part of [0, 1]) shareChoices(from![part], to![part]);
    });
  for (const end of ends) {
    for (const list of end.querySelectorAll('select')) list.removeAttribute('disabled');
    for (const shut of end.querySelectorAll('[data-disabled]')) {
      shut.removeAttribute('data-disabled');
      shut.setAttribute(
        'class',
        [...shut.classList].filter((name) => !name.startsWith('_disabled_')).join(' '),
      );
    }
  }
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

  blank,

  submitButton: (doc) => doc.querySelector<HTMLElement>('.ashby-application-form-submit-button'),

  // Ashby reads an attached resume and fills fields of its own; nothing on its page says when it's through.
  resumeRead: () => sleep(2500),

  // Ashby saves each answer to its server as it changes (a text half a second after the last keystroke, a choice at
  // once), and saves that overlap there can overwrite each other: a form filled all at once loses answers it still
  // shows, and the submission reports them missing. So one answer at a time, each saved before the next.
  async settle() {
    watchSaves();
    if (!live()) return;
    const before = saves;
    if (!(await waitFor(() => saves > before, 2500))) return;
    // Then a moment without another save landing: a text box can save twice, on leaving it and on its timer.
    let count = saves;
    let quietSince = Date.now();
    await waitFor(() => {
      if (saves !== count) {
        count = saves;
        quietSince = Date.now();
      }
      return Date.now() - quietSince >= 300;
    }, 2000);
  },

  // The form gives way to a box of Ashby's own, and the button that sent it is gone. What the box says is the
  // company's to word ("Your application was successfully submitted…" where it words nothing), so the box is what
  // tells, and its words only where there's no such box.
  confirmed(doc) {
    if (doc.querySelector('.ashby-application-form-submit-button')) return false;
    if (doc.querySelector('.ashby-application-form-success-container')) return true;
    const text = wordsAt(doc, ['[class*="success"]', 'body'], 3000);
    return /thank you for applying|thanks for applying|application (was |has been )?(submitted|received)|successfully submitted/i.test(
      text,
    );
  },
};
