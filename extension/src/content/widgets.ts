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

/** Opens a combobox (react-select and the like) and returns its option elements. */
export async function openCombobox(input: HTMLElement): Promise<HTMLElement[]> {
  input.focus();
  const control = input.closest<HTMLElement>('.select__control, [class*="control"]') ?? input;
  clickLikeAPerson(control);
  key(input, 'ArrowDown');
  const listbox = await waitFor(() => {
    const box = listboxFor(input);
    return box && optionsIn(box).length > 0 ? box : null;
  }, 800);
  return listbox ? optionsIn(listbox) : [];
}

export function closeCombobox(input: HTMLElement): void {
  key(input, 'Escape');
  input.blur();
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
  await sleep(30);
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
 * Types into a search-as-you-type field and picks a suggestion: locations, schools. When no suggestion appears the
 * typed text stays, which many forms accept.
 */
export async function pickFromTypeahead(
  input: HTMLInputElement,
  query: string,
  choose: (texts: string[]) => string | null,
): Promise<string | null> {
  setNativeValue(input, query);
  const options = await waitFor(() => {
    const box =
      listboxFor(input) ??
      input.closest('li, .application-field, div')?.querySelector<HTMLElement>('.dropdown-results');
    if (!box) return null;
    const items = [
      ...box.querySelectorAll<HTMLElement>('[role="option"], .dropdown-location, li, .pac-item'),
    ].filter((item) => textOf(item));
    return items.length ? items : null;
  }, 2500);
  if (!options) return null;
  const texts = options.map((option) => textOf(option));
  const choice = choose(texts) ?? texts[0] ?? null;
  const target = choice === null ? undefined : options[texts.indexOf(choice)];
  if (!target) return null;
  clickLikeAPerson(target);
  await sleep(30);
  return choice;
}
