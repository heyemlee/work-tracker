import { clean } from '../text';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls until `probe` returns something, or gives up after `timeout` ms. */
export async function waitFor<T>(
  probe: () => T | null | undefined,
  timeout = 2000,
  interval = 50,
): Promise<T | null> {
  const started = Date.now();
  for (;;) {
    const found = probe();
    if (found) return found;
    if (Date.now() - started >= timeout) return null;
    await sleep(interval);
  }
}

/** Visible text, whitespace collapsed; hidden descendants (screen-reader-only duplicates aside) included. */
export function textOf(element: Element | null | undefined): string {
  if (!element) return '';
  return clean(element.textContent ?? '');
}

/**
 * Hidden from the person filling the form. Layout isn't consulted (tests run without one); attributes and styles
 * are. File inputs are usually hidden behind a button and are handled separately.
 */
export function isHidden(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return true;
  let node: Element | null = element;
  for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
  }
  return false;
}

/** Escapes a value for a quoted attribute selector. */
export const attributeValue = (value: string) => value.replace(/["\\]/g, '\\$&');

const byId = (root: Document, id: string) => (id ? root.getElementById(id) : null);

/** The text that names a control, from the most to the least explicit source. */
export function labelOf(control: Element): string {
  const doc = control.ownerDocument;
  const labelledBy = control.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => textOf(byId(doc, id)))
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }
  const id = control.getAttribute('id');
  if (id) {
    const label = doc.querySelector(`label[for="${attributeValue(id)}"]`);
    if (label && !label.classList.contains('visually-hidden')) {
      const text = textOf(label);
      if (text) return text;
    }
  }
  const wrapping = control.closest('label');
  if (wrapping) {
    // Lever wraps a whole question in its label; the question is the label-like part.
    const inner = wrapping.querySelector(
      '.application-label, [class*="label"]:not(input):not(select):not(textarea)',
    );
    const text = textOf(inner ?? wrapping);
    if (text) return text;
  }
  const aria = control.getAttribute('aria-label');
  if (aria) return clean(aria);
  const container = questionContainer(control);
  if (container) {
    const text = questionText(container);
    if (text) return text;
  }
  const placeholder = control.getAttribute('placeholder');
  if (placeholder) return clean(placeholder);
  return humanize(control.getAttribute('name') ?? '');
}

/** Help text a control points at: `aria-describedby` minus error and character-count messages. */
export function descriptionOf(control: Element): string {
  const ids = (control.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((id) => id && !/error|count|placeholder/i.test(id));
  return ids
    .map((id) => textOf(byId(control.ownerDocument, id)))
    .filter(Boolean)
    .join(' ');
}

/** The nearest ancestor that holds one question: a fieldset, a list item, or a block with a label-like child. */
export function questionContainer(control: Element): Element | null {
  let node = control.parentElement;
  for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
    if (
      node.matches(
        'fieldset, [role="group"], [role="radiogroup"], li, .field, .application-question, [class*="field-entry"], [class*="formField"], [data-automation-id^="formField"]',
      )
    ) {
      return node;
    }
    if (node.matches('form, body')) return null;
  }
  return null;
}

const QUESTION_SELECTOR =
  'legend, label, .label, [class*="label"], [class*="question-title"], [class*="question"] > .text, h3, h4, [role="heading"]';

/** The question a container asks: its first label-like element that isn't one of the answer choices. */
export function questionText(container: Element): string {
  for (const candidate of container.querySelectorAll(QUESTION_SELECTOR)) {
    if (candidate.querySelector('input, select, textarea') && candidate.matches('label')) continue;
    const text = textOf(candidate);
    if (text) return text;
  }
  return '';
}

/** The heading of the section a control sits in, e.g. "Voluntary Self-Identification". */
export function sectionOf(control: Element): string {
  let node: Element | null = control;
  for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
    let sibling = node.previousElementSibling;
    for (let steps = 0; sibling && steps < 20; steps++, sibling = sibling.previousElementSibling) {
      const heading = sibling.matches('h1, h2, h3, legend, [role="heading"]')
        ? sibling
        : sibling.querySelector('h2, h3, legend');
      if (heading) return textOf(heading);
    }
  }
  return '';
}

export function isRequired(control: Element, label: string): boolean {
  if (control.hasAttribute('required') || control.getAttribute('aria-required') === 'true') return true;
  const container = questionContainer(control);
  if (container?.querySelector('.required, [class*="required"], abbr[title="required"]')) return true;
  return /[*✱]\s*$/.test(label);
}

/** "urls[LinkedIn]" → "LinkedIn", "first_name" → "first name". */
function humanize(name: string): string {
  const inner = /\[([^\]]+)\]$/.exec(name)?.[1] ?? name;
  return clean(inner.replace(/[_-]+/g, ' '));
}

/**
 * The object literal assigned after `marker` in an inline script, as in `window.__appData = {…};` followed by more
 * code. Walks to the brace that closes it, skipping braces inside strings, and parses only that.
 */
export function jsonAfter(source: string, marker: string): unknown {
  const at = source.indexOf(marker);
  const start = at < 0 ? -1 : source.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '\\') index++;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try {
        return JSON.parse(source.slice(start, index + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The text of an HTML string from a page's data, e.g. a posting's description, with blocks kept apart. */
export function htmlText(html: string | undefined): string {
  if (!html) return '';
  const spaced = html.replace(/<\/(p|div|h[1-6]|li|td|th|tr|blockquote)>|<br\s*\/?>/gi, '$& ');
  return clean(new DOMParser().parseFromString(spaced, 'text/html').body.textContent ?? '');
}
