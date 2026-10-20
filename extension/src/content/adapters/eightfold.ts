import { companyFromSlug } from '@domain/postings';
import type { Hint } from '../../model';
import { attributeValue, isHidden, labelOf, sleep, textOf, waitFor } from '../dom';
import { postingFrom, submittedText } from './shared';
import type { Adapter, CustomField } from './types';

/*
 * Eightfold's careers sites (app.eightfold.ai, and a company's own *.eightfold.ai) draw the application in the
 * visitor's language, which it takes from the browser's: in Chinese for the owner. Its own fields are told by their
 * ids, and each choice of a question keeps the English it was written in, in its `data-test-id` and its
 * `aria-label` ("Male, Gender"), whatever the page shows.
 */

const HINTS: Record<string, Hint> = {
  _____email: 'email',
  _____firstname: 'name.first',
  _____lastname: 'name.last',
  // The country's dialing code is a dropdown of its own, and the number takes only digits, dashes and brackets.
  _____phone: 'phone.national',
  '_____phone-country-code': 'phone.country',
  _____country: 'address.country',
  _____state: 'address.state',
  _____city: 'address.city',
};

/** A question that names nothing, put under a heading that does ("Disability Status"). */
const PROMPT = /^(please )?(check|select|choose|tick|mark) (one|an?|any)\b/i;

function form(doc: Document): HTMLFormElement | null {
  return (
    [...doc.querySelectorAll('form')].find(
      (node) =>
        !isHidden(node) &&
        !!node.querySelector('[data-test-id="submitApplicationButton"]') &&
        !!node.querySelector('[data-form-section-id]'),
    ) ?? null
  );
}

/** A label the page marks as a required question's, by a class of its own. */
const requiredLabel = (label: Element | null) => /(^|\s)required-/.test(label?.className ?? '');

function hintOf(control: Element): Hint | null {
  const id = control.id || control.closest('[data-test-id]')?.getAttribute('data-test-id') || '';
  return HINTS[id] ?? HINTS[control.closest('[id^="_____"]')?.id ?? ''] ?? null;
}

/** Dropdowns that search as they're typed in, and show their pick as their own text. */
function dropdowns(root: Element): CustomField[] {
  return [...root.querySelectorAll<HTMLInputElement>('input[role="combobox"]')].flatMap((input) =>
    isHidden(input) || input.disabled
      ? []
      : [
          {
            label: labelOf(input),
            kind: 'combobox' as const,
            options: [],
            required: input.getAttribute('aria-required') === 'true',
            hint: hintOf(input),
            handle: { type: 'combobox' as const, element: input, shown: () => input.value.trim() || null },
            anchor: input.closest('[data-test-id]') ?? input,
          },
        ],
  );
}

/** A choice's own words: its box's test id is the question's id, a dash, and the choice as it was written. */
function choiceOf(group: Element, input: HTMLInputElement): string {
  const id = input.closest('[data-test-id]')?.getAttribute('data-test-id') ?? '';
  const written = id.startsWith(`${group.id}-`) ? id.slice(group.id.length + 1) : '';
  return written.trim() || textOf(input.closest('[data-test-id]')?.querySelector('label'));
}

/**
 * The heading a question's id starts with: the section's title as it was written, its words joined by underscores,
 * ahead of the question's own id in lower case ("Disability_Status_disability_status").
 */
function headingOf(group: Element): string {
  const words: string[] = [];
  for (const word of group.id.split('_')) {
    if (!/^[A-Z]/.test(word)) break;
    words.push(word);
  }
  return words.join(' ');
}

function radios(root: Element): CustomField[] {
  return [...root.querySelectorAll<HTMLElement>('[role="radiogroup"][id]')].flatMap((group) => {
    const inputs = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    const [first] = inputs;
    if (!first || isHidden(group)) return [];
    const choices = inputs.map((input) => choiceOf(group, input));
    // Each choice's label for a screen reader is the choice, then the question.
    const spoken = first.getAttribute('aria-label') ?? '';
    const asked = spoken.startsWith(`${choices[0]}, `) ? spoken.slice(`${choices[0]}, `.length).trim() : '';
    const own = root.querySelector(`[id="${attributeValue(`${group.id}_label`)}"]`);
    const label = (PROMPT.test(asked) ? headingOf(group) : asked) || textOf(own);
    return [
      {
        label,
        kind: 'radio',
        options: choices,
        required: requiredLabel(own),
        handle: { type: 'radio', inputs, labels: choices },
        anchor: group,
      },
    ];
  });
}

function resume(root: Element): CustomField[] {
  const input = root.querySelector<HTMLInputElement>('.upload-resume-dropzone input[type="file"]');
  if (!input) return [];
  const label = root.querySelector('#___resume_label');
  return [
    {
      label: textOf(label) || 'Resume',
      kind: 'file',
      options: [],
      required: requiredLabel(label),
      hint: 'resume',
      handle: { type: 'file', element: input },
      anchor: input.closest('fieldset') ?? input,
    },
  ];
}

/** The resume's upload is under way: Eightfold reads it and fills the contact fields from it. */
const uploading = (doc: Document) => !!form(doc)?.querySelector('[class*="upload-list-item-uploading"]');

export const eightfold: Adapter = {
  ats: 'eightfold',
  form,
  posting(doc, url) {
    // The posting's own page, whether this is it (/careers/job/<pid>) or its application (/careers/apply?pid=<pid>).
    const link = new URL(url);
    const pid = link.searchParams.get('pid') ?? /\/careers\/job\/(\d+)/.exec(link.pathname)?.[1];
    const domain = link.searchParams.get('domain');
    const job = pid
      ? `${link.origin}/careers/job/${pid}${domain ? `?domain=${encodeURIComponent(domain)}` : ''}`
      : link.href;
    const posting = postingFrom(doc, job, 'eightfold', {
      title: '[class*="jobCartPositionName"]',
      location: '[class*="jobCartPositionInfo"] [class*="locationItem"]',
      description: '[class*="jobDescription"]',
    });
    // Where the posting doesn't name its company, the address does: app.eightfold.ai/careers?domain=acme.com, or
    // acme.eightfold.ai. "Eightfold", read off the host, is the platform's name.
    const site = link.hostname.split('.')[0];
    const owner = domain?.split('.')[0] ?? (site !== 'app' ? site : null);
    const company = posting.company === 'Eightfold' && owner ? companyFromSlug(owner, []) : posting.company;
    return { ...posting, company, url: job };
  },
  hint: hintOf,
  // Eightfold's own box under the form, "Save my answers for future applications", is no question of the employer's.
  skip: (control) => !control.closest('[data-form-section-id]'),
  custom: (root) => [...resume(root), ...dropdowns(root), ...radios(root)],
  // Its fields hand a typed value on to the form a moment late: one left at once is checked as empty, and says so in
  // red ("can't be blank") until it's left again. So each is left again once it has its value.
  async settle() {
    await sleep(60);
    const active = document.activeElement;
    if (active instanceof HTMLElement && form(document)?.contains(active)) active.blur();
  },
  async resumeRead(doc) {
    await sleep(500);
    await waitFor(() => !uploading(doc), 10000);
  },
  submitButton: (doc) =>
    form(doc)?.querySelector<HTMLElement>('[data-test-id="submitApplicationButton"]') ?? null,
  // The page shows its thanks over the form, in the page's language or the company's own words.
  confirmed: (doc) =>
    !!doc.querySelector('#form-submission-success-message') ||
    submittedText(doc, '[class*="formSubmission"], main'),
};
