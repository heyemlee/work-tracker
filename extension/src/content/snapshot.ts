import type { PlannedField } from '../model';
import type { FormSnapshot } from '../storage';
import type { Adapter } from './adapters/types';
import type { Extraction } from './extract';

/**
 * Elements whose text shows what was typed or chosen: emptied in a snapshot. An attached file is named in an element
 * of its own ("filename" on Lever, "file-upload__filename" on Greenhouse), and a resume's name is often the owner's.
 */
const SHOWS_VALUE =
  '[class*="single-value"], [class*="multi-value"], [class*="filename"], [data-automation-id="selectedItem"], [class*="selected-value"], output';

/**
 * The form's structure for a test fixture: labels, kinds, options, and what the extension did, with every value
 * the owner or the extension put in taken out. Hidden inputs (tokens, ids) are dropped entirely.
 */
export function formSnapshot(
  adapter: Adapter,
  doc: Document,
  extraction: Extraction,
  plan: readonly PlannedField[],
): Omit<FormSnapshot, 'id' | 'at'> | null {
  const form = adapter.form(doc);
  if (!form) return null;
  const byId = new Map(plan.map((entry) => [entry.fieldId, entry]));
  const copy = form.cloneNode(true) as Element;
  for (const element of copy.querySelectorAll(
    'script, style, svg, iframe, img, video, canvas, noscript, input[type="hidden"], input[type="password"]',
  ))
    element.remove();
  for (const input of copy.querySelectorAll('input')) {
    input.removeAttribute('value');
    input.removeAttribute('checked');
    if (input.type === 'file') input.removeAttribute('data-file');
  }
  for (const textarea of copy.querySelectorAll('textarea')) textarea.textContent = '';
  for (const option of copy.querySelectorAll('option')) option.removeAttribute('selected');
  for (const shown of copy.querySelectorAll(SHOWS_VALUE)) shown.textContent = '';
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
  const location = doc.location;
  return {
    ats: adapter.ats,
    url: location ? `${location.origin}${location.pathname}` : '',
    step: adapter.step?.(doc) ?? null,
    fields: extraction.fields.map((field) => ({
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
