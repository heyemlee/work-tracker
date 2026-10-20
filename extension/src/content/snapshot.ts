import type { OwnerTraces, PlannedField } from '../model';
import type { FormSnapshot } from '../storage';
import type { Adapter } from './adapters/types';
import { FILE_NAME, type Extraction } from './extract';

/**
 * Elements whose text shows what was typed or chosen: emptied in a snapshot. An attached file is named in an element
 * of its own ("filename" on Lever, "file-upload__filename" on Greenhouse), and a resume's name is often the owner's.
 */
const SHOWS_VALUE =
  '[class*="single-value"], [class*="multi-value"], [class*="filename"], [data-automation-id="selectedItem"], [class*="selected-value"], output';

/** The element the card is drawn in (`ui/card/shadow.tsx`): no part of the page a report is of. */
const CARD_HOST = 'outbox-autofill';

/** An email address, whoever's: the owner's, the account a site shows them signed in with, one it writes to. */
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Takes the owner out of what a copy says outside its inputs: their names and street wherever they stand as words,
 * their phone however its digits are spaced, and every email address.
 */
function leaveOut(copy: Element, owner: OwnerTraces): void {
  // Emails first: the owner's is often made of their name, and would no longer read as an email without it.
  const traces = [
    EMAIL,
    ...owner.words.map(
      (word) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'giu'),
    ),
    ...(owner.phone.length >= 7 ? [new RegExp(owner.phone.split('').join('[\\s().-]*'), 'g')] : []),
  ];
  const clean = (text: string) => traces.reduce((left, trace) => left.replace(trace, ''), text);
  const walker = copy.ownerDocument.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    node.textContent = clean(node.textContent ?? '');
  for (const element of [copy, ...copy.querySelectorAll('*')])
    for (const attribute of [...element.attributes]) {
      const left = clean(attribute.value);
      if (left !== attribute.value) element.setAttribute(attribute.name, left);
    }
}

/**
 * A copy of `root` with every value the owner or the extension put in taken out, hidden inputs dropped, and the
 * owner left out of what it says besides.
 */
function blankCopy(adapter: Adapter, root: Element, owner: OwnerTraces): Element {
  const copy = root.cloneNode(true) as Element;
  for (const element of copy.querySelectorAll(
    `script, style, link, svg, iframe, img, video, canvas, noscript, input[type="hidden"], input[type="password"], ${CARD_HOST}`,
  ))
    element.remove();
  for (const input of copy.querySelectorAll('input')) {
    input.removeAttribute('value');
    input.removeAttribute('checked');
    if (input.type === 'file') input.removeAttribute('data-file');
  }
  for (const textarea of copy.querySelectorAll('textarea')) textarea.textContent = '';
  // A box for text drawn without a textarea, as rich-text editors are: it holds what was typed as its own text.
  for (const box of copy.querySelectorAll('[contenteditable]:not([contenteditable="false"])'))
    box.textContent = '';
  for (const option of copy.querySelectorAll('option')) option.removeAttribute('selected');
  for (const shown of copy.querySelectorAll(SHOWS_VALUE)) shown.textContent = '';
  // A file's name shown in a page's own words, on a button or beside the upload (Cursor's "🗎 Alex_Chen_Resume.pdf").
  const texts = copy.ownerDocument.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = texts.nextNode(); node; node = texts.nextNode())
    if (FILE_NAME.test((node.textContent ?? '').trim())) node.textContent = '';
  // Google Tag Manager marks each control a visitor has touched, which tells the choice they made.
  for (const element of copy.querySelectorAll(
    '[data-gtm-form-interact-field-id], [data-gtm-form-interact-id]',
  )) {
    element.removeAttribute('data-gtm-form-interact-field-id');
    element.removeAttribute('data-gtm-form-interact-id');
  }
  // select2 (Lever's school list) shows a pick as its text and again as its tooltip; with none, it shows its prompt.
  for (const pick of copy.querySelectorAll('.select2-selection__rendered[title]')) {
    pick.textContent = '';
    pick.removeAttribute('title');
  }
  // intl-tel-input (Greenhouse's phone box) names the number's country on its button, for a tooltip and a screen
  // reader, and draws that country's flag by a class.
  for (const country of copy.querySelectorAll('.iti__selected-country')) {
    country.removeAttribute('title');
    country.removeAttribute('aria-label');
    for (const flag of country.querySelectorAll('.iti__flag')) flag.className = 'iti__flag';
  }
  // Workday's dropdown buttons carry the chosen option as their text, value and label.
  for (const button of copy.querySelectorAll('button[aria-haspopup="listbox"]')) {
    button.textContent = '';
    button.setAttribute('value', '');
    button.removeAttribute('aria-label');
  }
  for (const element of copy.querySelectorAll('[aria-pressed="true"], [aria-checked="true"]')) {
    element.setAttribute(element.hasAttribute('aria-pressed') ? 'aria-pressed' : 'aria-checked', 'false');
  }
  // And what only the page's adapter knows to hold an answer.
  adapter.blank?.(copy);
  leaveOut(copy, owner);
  return copy;
}

const NO_ONE: OwnerTraces = { words: [], phone: '' };

function report(
  adapter: Adapter,
  doc: Document,
  copy: Element,
  fields: Extraction['fields'],
  plan: readonly PlannedField[],
): Omit<FormSnapshot, 'id' | 'at'> {
  const byId = new Map(plan.map((entry) => [entry.fieldId, entry]));
  const location = doc.location;
  return {
    ats: adapter.ats,
    url: location ? `${location.origin}${location.pathname}` : '',
    step: adapter.step?.(doc) ?? null,
    fields: fields.map((field) => ({
      label: field.label,
      kind: field.kind,
      options: field.options,
      required: field.required,
      hint: field.hint,
      section: field.section,
      status: byId.get(field.id)?.status ?? null,
      key: byId.get(field.id)?.key ?? null,
    })),
    html: copy.outerHTML.slice(0, 400_000),
  };
}

/**
 * The form's structure for a test fixture: labels, kinds, options, and what the extension did, with every value
 * the owner or the extension put in taken out. Hidden inputs (tokens, ids) are dropped entirely.
 */
export function formSnapshot(
  adapter: Adapter,
  doc: Document,
  extraction: Extraction,
  plan: readonly PlannedField[],
  owner: OwnerTraces = NO_ONE,
): Omit<FormSnapshot, 'id' | 'at'> | null {
  const form = adapter.form(doc);
  if (!form) return null;
  return report(adapter, doc, blankCopy(adapter, form, owner), extraction.fields, plan);
}

/**
 * The page itself, where no form was read on it: one the extension doesn't know how to read yet, which is what a
 * report is most often for. Blanked as a form is; the card the report was asked for from isn't kept.
 */
export function pageSnapshot(
  adapter: Adapter,
  doc: Document,
  extraction: Extraction | null,
  owner: OwnerTraces = NO_ONE,
): Omit<FormSnapshot, 'id' | 'at'> | null {
  if (!doc.body) return null;
  return report(adapter, doc, blankCopy(adapter, doc.body, owner), extraction?.fields ?? [], []);
}
