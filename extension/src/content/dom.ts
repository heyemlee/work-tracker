import { clean } from '../text';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls until `probe` returns something, or gives up after `timeout` ms. It looks every `interval` ms; told the
 * answer comes `soon`, it looks again after 10 ms first and doubles the wait from there, up to `interval`: for a
 * page known to answer within a frame or two.
 */
export async function waitFor<T>(
  probe: () => T | null | undefined,
  timeout = 2000,
  interval = 50,
  soon = false,
): Promise<T | null> {
  const started = Date.now();
  for (let pause = soon ? Math.min(10, interval) : interval; ; pause = Math.min(pause * 2, interval)) {
    const found = probe();
    if (found) return found;
    const left = timeout - (Date.now() - started);
    if (left <= 0) return null;
    await sleep(Math.min(pause, left));
  }
}

/**
 * What the page says at the first of `places` it has, in the order they're given: a selector list would give the
 * first in the document's order, and `body` comes before anything in it. Its words only, not its scripts' or styles'
 * text, up to `limit` characters: for telling a confirmation by its words.
 */
export function wordsAt(doc: Document, places: readonly string[], limit: number): string {
  const place = places.map((selector) => doc.querySelector(selector)).find((found) => found !== null);
  if (!place) return '';
  const words: string[] = [];
  const walker = doc.createTreeWalker(place, NodeFilter.SHOW_TEXT);
  let length = 0;
  for (let node = walker.nextNode(); node && length < limit; node = walker.nextNode()) {
    if (node.parentElement?.closest('script, style, noscript, template')) continue;
    words.push(node.textContent ?? '');
    length += node.textContent?.length ?? 0;
  }
  return clean(words.join(' ')).slice(0, limit);
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

/** What a person fills in on a form. */
const CONTROLS = 'input:not([type="hidden"]), select, textarea, [role="combobox"]';

/** The element holds no form control but these: a question of its own, not a section of several. */
export function holdsOnly(element: Element, controls: readonly Element[]): boolean {
  return [...element.querySelectorAll(CONTROLS)].every(
    (control) => controls.includes(control) || controls.some((own) => own.contains(control)),
  );
}

/** What names one field, as against a group of them: not a legend or a heading. */
const LABEL_LIKE = 'label, .label, [class*="label"], [class*="question-title"], [class*="question"] > .text';

/**
 * The element before this one in the document's order, inside `root`: the last of its previous sibling's elements, or
 * its parent. (happy-dom's TreeWalker climbs past a parent's earlier siblings.)
 */
function previous(element: Element, root: Element): Element | null {
  let sibling = element.previousElementSibling;
  if (sibling) {
    while (sibling.lastElementChild) sibling = sibling.lastElementChild;
    return sibling;
  }
  const parent = element.parentElement;
  return parent && parent !== root ? parent : null;
}

/**
 * The label just before a control, read back from it to the first label-like element: never past another control,
 * out of `section`, or further than a few dozen elements. A dropdown is read back from its box, past the picks it shows.
 */
export function labelBefore(control: Element, section: Element | null = null): Element | null {
  const start = control.closest('[class*="select__control"]') ?? control;
  const root = section ?? control.closest('form') ?? control.ownerDocument.body;
  if (!root?.contains(start) || root === start) return null;
  for (
    let steps = 0, element = previous(start, root);
    element && steps < 40;
    steps++, element = previous(element, root)
  ) {
    // The control's own wrappers come before it in the document's order.
    if (element.contains(start)) continue;
    if (element.matches(CONTROLS)) return null;
    if (!element.matches(LABEL_LIKE) || element.querySelector(CONTROLS)) continue;
    // A part of a label ("*", a hint in a span) stands for the whole label.
    let label = element;
    for (
      let up = label.parentElement;
      up && up !== root && !up.contains(start) && up.matches(LABEL_LIKE);
      up = up.parentElement
    )
      label = up;
    // A label for something else is another field's: a choice's after its circle, or a date's over its month and year.
    const target = labelTarget(label);
    if (target && target !== control && !(target.contains(control) && holdsOnly(target, [control])))
      return null;
    if (/[\p{L}\p{N}]/u.test(textOf(label))) return label;
  }
  return null;
}

/** The element a `<label for>` names, where the page has one by that id. */
function labelTarget(label: Element): Element | null {
  const id = label.matches('label[for]') ? label.getAttribute('for') : null;
  const scope = label.getRootNode() as Document | ShadowRoot;
  return id && typeof scope.getElementById === 'function' ? scope.getElementById(id) : null;
}

/** What names a control by pointing at it or holding it: its ARIA name, or its label. */
function ownLabel(control: Element): string {
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
  return aria ? clean(aria) : '';
}

/**
 * The container asks several questions, as a form's section does: another control in it goes by a name of its own,
 * not by the container's heading (Pinpoint's "1. Personal Details" over First Name, Email, Street Address…). Its
 * heading then names none of them. A question in parts doesn't: Ashby's text-message consent under its phone field
 * goes by "Phone" as the phone does.
 */
export function asksSeveral(container: Element, controls: readonly Element[]): boolean {
  const heading = questionText(container);
  return [...container.querySelectorAll(CONTROLS)].some((other) => {
    if (controls.some((own) => own === other || own.contains(other))) return false;
    // A circle's or a box's own label names its choice; its question is the label before it.
    const choice = other.matches('input[type="radio"], input[type="checkbox"]');
    const name = (choice ? '' : ownLabel(other)) || textOf(labelBefore(other, container));
    return name !== '' && name !== heading;
  });
}

/** The text that names a control, from the most to the least explicit source. */
export function labelOf(control: Element): string {
  const own = ownLabel(control);
  if (own) return own;
  const container = questionContainer(control);
  if (container && !asksSeveral(container, [control])) {
    const text = questionText(container);
    if (text) return text;
  } else {
    // A section's heading ("1. Personal Details … Apply with LinkedIn" over Pinpoint's address fields) names none of
    // its questions, and was once filled into them as a LinkedIn link. The label just before the control names it;
    // with none, it has no name to be answered by.
    const text = textOf(labelBefore(control, container));
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

const REQUIRED_MARK = '.required, [class*="required"], abbr[title="required"]';

/** Whether the field must be answered; `controls` are all of its own, a group's boxes or circles. */
export function isRequired(
  control: Element,
  label: string,
  controls: readonly Element[] = [control],
): boolean {
  if (control.hasAttribute('required') || control.getAttribute('aria-required') === 'true') return true;
  const container = questionContainer(control);
  // In a section of several questions, a mark in it may be any of theirs: the control's own label carries its own.
  const marked =
    container && !asksSeveral(container, controls)
      ? container
      : labelBefore(controls[0] ?? control, container);
  if (marked?.matches(REQUIRED_MARK) || marked?.querySelector(REQUIRED_MARK)) return true;
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
