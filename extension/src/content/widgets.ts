import { norm } from '../text';
import { isHidden, sleep, textOf, waitFor } from './dom';

/**
 * Setting values so the page's framework notices. React tracks an input's value through the native setter, so
 * assigning `.value` alone is invisible to it: set through the prototype's setter, then fire the events a person's
 * typing would.
 */
export function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const prototype = Object.getPrototypeOf(element) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  element.focus();
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export function setText(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  setNativeValue(element, value);
  element.dispatchEvent(new Event('blur', { bubbles: false }));
  element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

/** Picks an option of a native select by its text. */
export function setSelect(select: HTMLSelectElement, optionText: string): boolean {
  const option = [...select.options].find((item) => norm(item.text) === norm(optionText));
  if (!option) return false;
  setNativeValue(select, option.value);
  return true;
}

export function clickLikeAPerson(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView ?? window;
  const init = { bubbles: true, cancelable: true, view, button: 0 };
  element.dispatchEvent(new PointerEvent('pointerdown', init));
  element.dispatchEvent(new MouseEvent('mousedown', init));
  element.dispatchEvent(new PointerEvent('pointerup', init));
  element.dispatchEvent(new MouseEvent('mouseup', init));
  element.click();
}

export function setChecked(input: HTMLInputElement, checked: boolean): void {
  if (input.checked !== checked) input.click();
}

/** Attaches a file the way a drop or a file picker would. */
export function setFiles(input: HTMLInputElement, files: File[]): void {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function fileFromBase64(base64: string, name: string, type: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type });
}

function key(element: HTMLElement, name: string, code = name): void {
  const init = { key: name, code, bubbles: true, cancelable: true };
  element.dispatchEvent(new KeyboardEvent('keydown', init));
  element.dispatchEvent(new KeyboardEvent('keyup', init));
}

/** The listbox a combobox controls, or the nearest open menu. */
function listboxFor(input: HTMLElement): HTMLElement | null {
  const doc = input.ownerDocument;
  const controls = input.getAttribute('aria-controls') ?? input.getAttribute('aria-owns');
  const byId = controls ? doc.getElementById(controls) : null;
  if (byId) return byId;
  // react-select draws its menu beside its control. With none there it is closed, and another list on the page (a
  // phone widget's hidden countries) isn't this field's.
  const control = input.closest('[class*="select__control"]');
  if (control) {
    const shell = control.closest('.select-shell') ?? control.parentElement;
    return shell?.querySelector<HTMLElement>('[role="listbox"], [class*="select__menu"]') ?? null;
  }
  const container =
    input.closest(
      '.select, .select-shell, [class*="select__container"], [class*="container"], [data-automation-id]',
    ) ?? input.parentElement;
  const near = container?.querySelector<HTMLElement>('[role="listbox"], .select__menu, [class*="menu"]');
  if (near) return near;
  return doc.querySelector<HTMLElement>('[role="listbox"]:not([hidden])');
}

function optionsIn(listbox: HTMLElement): HTMLElement[] {
  const found = [
    ...listbox.querySelectorAll<HTMLElement>(
      '[role="option"], [data-automation-id="promptOption"], .select__option',
    ),
  ];
  return found.filter((option) => !isHidden(option));
}

/**
 * The control is react-select's. Its list is there by its next render and gone by the one after a pick, as tried on
 * Greenhouse's own page code: waits on it look again at once, and end when it has answered. Any other widget —
 * Workday's, Ashby's — keeps the pace and the pause it had, there being no page of theirs to try shorter ones on.
 */
const isReactSelect = (input: HTMLElement) => input.closest('[class*="select__control"]') !== null;

/** Opens a combobox (react-select and the like) and returns its option elements. */
export async function openCombobox(input: HTMLElement): Promise<HTMLElement[]> {
  input.focus();
  const control = input.closest<HTMLElement>('.select__control, [class*="control"]') ?? input;
  clickLikeAPerson(control);
  key(input, 'ArrowDown');
  const listbox = await waitFor(
    () => {
      const box = listboxFor(input);
      return box && optionsIn(box).length > 0 ? box : null;
    },
    800,
    50,
    isReactSelect(input),
  );
  return listbox ? optionsIn(listbox) : [];
}

export function closeCombobox(input: HTMLElement): void {
  key(input, 'Escape');
  input.blur();
}

/**
 * Clicks somewhere neutral, as a person does to close a popup: Workday's prompts stay open after a choice and close
 * on a press outside them, which the page listens for on the document. Escape and a blur follow for other widgets.
 */
export function clickAway(input: HTMLElement): void {
  const doc = input.ownerDocument;
  const view = doc.defaultView ?? window;
  const away = doc.body;
  const at = { bubbles: true, cancelable: true, view, clientX: 1, clientY: 1, button: 0 };
  away.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse' }));
  away.dispatchEvent(new MouseEvent('mousedown', at));
  away.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'mouse' }));
  away.dispatchEvent(new MouseEvent('mouseup', at));
  away.dispatchEvent(new MouseEvent('click', at));
  key(input, 'Escape');
  input.blur();
}

/**
 * After a pick, closes a menu that stayed open, as a person would by clicking away: Workday's prompts keep their
 * list up after a choice. A menu gets 150 ms to close by itself, and one that did is left alone. react-select's is
 * gone by its next render, and the wait with it.
 */
async function closeIfOpen(input: HTMLElement): Promise<void> {
  const closed = () => {
    const box = listboxFor(input);
    return !(box && !isHidden(box) && optionsIn(box).length > 0);
  };
  if (!isReactSelect(input)) await sleep(150);
  else if (await waitFor(closed, 150, 50, true)) return;
  if (!closed()) clickAway(input);
}

/**
 * Opens the combobox, lets `choose` pick among the option texts, and clicks the choice. Returns the chosen text,
 * or null when nothing fit (the menu is closed again untouched).
 */
export async function pickFromCombobox(
  input: HTMLElement,
  choose: (texts: string[]) => string | null,
): Promise<string | null> {
  const options = await openCombobox(input);
  const texts = options.map((option) => textOf(option));
  const choice = choose(texts);
  const index = choice === null ? -1 : texts.indexOf(choice);
  const target = options[index];
  if (!target) {
    closeCombobox(input);
    return null;
  }
  target.scrollIntoView?.({ block: 'nearest' });
  clickLikeAPerson(target);
  await closeIfOpen(input);
  return choice;
}

/** Reads a combobox's option texts without choosing any. */
export async function readComboboxOptions(input: HTMLElement): Promise<string[]> {
  const options = await openCombobox(input);
  const texts = options.map((option) => textOf(option));
  closeCombobox(input);
  return texts;
}

/**
 * Types into a search-as-you-type field and picks the suggestion `choose` settles on: locations, schools. The list
 * can show something else first (a school list's first page while the search runs), so it is read until one fits.
 * Null when none does; the typed text stays.
 */
export async function pickFromTypeahead(
  input: HTMLInputElement,
  query: string,
  choose: (texts: string[]) => string | null,
  /** Close the list afterwards whether or not it looks open: Workday's prompts don't mark theirs. */
  alwaysClose = false,
): Promise<string | null> {
  setNativeValue(input, query);
  // Typing ends on a key coming up, and Greenhouse's dropdowns open their list on that, not on the text changing.
  key(input, query.slice(-1));
  const found = await waitFor(
    () => {
      const box =
        listboxFor(input) ??
        input.closest('li, .application-field, div')?.querySelector<HTMLElement>('.dropdown-results');
      if (!box) return null;
      const items = [
        ...box.querySelectorAll<HTMLElement>('[role="option"], .dropdown-location, li, .pac-item'),
      ].filter((item) => textOf(item) && !isHidden(item));
      const texts = items.map((item) => textOf(item));
      const choice = choose(texts);
      const target = choice === null ? undefined : items[texts.indexOf(choice)];
      return target ? { target, choice } : null;
    },
    4000,
    50,
    isReactSelect(input),
  );
  if (!found) return null;
  const { target, choice } = found;
  clickLikeAPerson(target);
  if (alwaysClose) {
    await sleep(150);
    clickAway(input);
  } else await closeIfOpen(input);
  return choice;
}
