import type { FieldKind, ScannedField } from '../model';
import { clean } from '../text';
import type { Adapter, CustomField, Handle } from './adapters/types';
import {
  attributeValue,
  descriptionOf,
  isHidden,
  isRequired,
  labelOf,
  questionContainer,
  questionText,
  sectionOf,
  textOf,
} from './dom';

export interface Extraction {
  fields: ScannedField[];
  handles: Map<string, Handle>;
  /** Where each field sits, for scrolling to it from the checklist. */
  anchors: Map<string, Element>;
}

const TEXT_TYPES: Record<string, FieldKind> = {
  text: 'text',
  search: 'text',
  email: 'email',
  tel: 'tel',
  url: 'url',
  number: 'number',
  date: 'date',
  month: 'date',
};

const IGNORED_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password', 'range', 'color']);
const CAPTCHA = /captcha|recaptcha|hcaptcha|h-captcha|cf-turnstile/i;

/** The label of one choice in a radio or checkbox group. */
function choiceLabel(input: HTMLInputElement): string {
  const id = input.id;
  const byFor = id ? input.ownerDocument.querySelector(`label[for="${attributeValue(id)}"]`) : null;
  const text =
    textOf(byFor ?? input.closest('label')) ||
    clean(input.getAttribute('aria-label') ?? '') ||
    clean(input.value);
  return text;
}

/** The element holds no form control but these: a question of its own, not a section of several. */
function holdsOnly(element: Element, inputs: HTMLInputElement[]): boolean {
  return [...element.querySelectorAll('input:not([type="hidden"]), select, textarea')].every((control) =>
    inputs.includes(control as HTMLInputElement),
  );
}

function groupLabel(inputs: HTMLInputElement[]): string {
  const first = inputs[0];
  if (!first) return '';
  // A lone box inside a section ("Legal Name" around "I have a preferred name") is named by its own label.
  const lone = inputs.length === 1 && first.type === 'checkbox';
  const group = first.closest('[role="radiogroup"], [role="group"]');
  const labelledBy =
    group && !(lone && !holdsOnly(group, inputs)) ? group.getAttribute('aria-labelledby') : null;
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => textOf(first.ownerDocument.getElementById(id)))
      .join(' ')
      .trim();
    if (text) return text;
  }
  const fieldset = first.closest('fieldset');
  const legend =
    fieldset && !(lone && !holdsOnly(fieldset, inputs)) ? fieldset.querySelector('legend') : null;
  if (legend) return textOf(legend);
  const container = questionContainer(first);
  // A container holding only this input's own label is a choice, not the question: look one level up.
  const questionBox =
    container && inputs.every((input) => container.contains(input))
      ? container
      : questionContainer(container ?? first);
  const text = questionBox ? questionText(questionBox) : '';
  const choices = new Set(inputs.map(choiceLabel));
  return choices.has(text) ? '' : text;
}

/** "Alex_Chen_Resume.pdf", not "Accepted types: .pdf, .docx" or "Upload .pdf". */
const FILE_NAME = /^[^\s:,][^:,]{0,200}[^\s.:,]\.(pdf|docx?|rtf|odt|txt)$/i;

/**
 * The file an upload holds: the one chosen in it, or one the page shows by name next to it, as Workday does with the
 * resume "Autofill with Resume" read and Lever with one the owner attached.
 */
export function attachedFile(input: HTMLInputElement): string | null {
  const chosen = input.files?.[0];
  if (chosen) return chosen.name;
  const box = questionContainer(input) ?? input.parentElement?.parentElement?.parentElement;
  for (const element of box?.querySelectorAll('*') ?? []) {
    if (element.childElementCount === 0 && FILE_NAME.test(textOf(element))) return textOf(element);
  }
  return null;
}

/** The file an upload's field holds: the one the page shows, where the adapter reads that, else as the input tells. */
export function heldFile(handle: Extract<Handle, { type: 'file' }>): string | null {
  return handle.shown ? handle.shown() : attachedFile(handle.element);
}

/**
 * The box of a custom dropdown that shows its pick beside the search input: react-select's control, or another
 * library's container. Not the wrapper round the input alone, which react-select calls a container too and which
 * holds no pick: taken for the box, it made every dropdown of Greenhouse's read as empty.
 */
export function pickBox(control: Element): Element | null {
  return (
    control.closest('[class*="select__control"]') ??
    control.closest('[class*="container"]:not([class*="input-container"])')
  );
}

/** The picks a multi-select shows as chips beside its search box. */
export function chipsOf(control: Element): string[] {
  const chips = control
    .closest('[class*="select__control"]')
    ?.querySelectorAll('[class*="multi-value__label"]');
  return [...(chips ?? [])].map((chip) => textOf(chip)).filter(Boolean);
}

/**
 * The field collects picks and holds one already: a multi-select's chips, Workday's selected items. Picking again
 * would add a second choice beside the first, or take the first back out.
 */
export function holdsPicks(handle: Handle): boolean {
  if (handle.type === 'prompt') return isFilled(handle);
  return (handle.type === 'combobox' || handle.type === 'typeahead') && chipsOf(handle.element).length > 0;
}

/**
 * The button of a group that stands pressed: it says so (Ashby's Yes/No), or its class does, as a rating's number
 * does on Gem, "selected" and nothing else.
 */
export function pressed(button: Element): boolean {
  return (
    button.getAttribute('aria-pressed') === 'true' ||
    button.getAttribute('aria-checked') === 'true' ||
    // Not "unselected", nor Gem's "interactiveButton", which every button of a rating carries.
    /(?<![a-z])(selected|active)/.test(button.className)
  );
}

/** The field holds something: the page filled it in, or the owner did. */
export function isFilled(handle: Handle): boolean {
  switch (handle.type) {
    case 'input':
      return handle.element.value.trim() !== '';
    case 'typeahead':
      // A dropdown's search box (Greenhouse's city and school) shows its pick beside the input, not in it.
      return (
        handle.element.value.trim() !== '' ||
        Boolean(
          handle.element
            .closest('[class*="select__control"]')
            ?.querySelector('[class*="single-value"], [class*="multi-value"]'),
        )
      );
    case 'select':
      return (
        handle.element.selectedIndex > 0 ||
        (handle.element.selectedIndex === 0 &&
          handle.element.value !== '' &&
          !/select|choose|--/i.test(handle.element.options[0]?.text ?? ''))
      );
    case 'radio':
    case 'multi':
      return handle.inputs.some((input) => input.checked);
    case 'checkbox':
      return handle.element.checked;
    case 'file':
      return heldFile(handle) !== null;
    case 'combobox': {
      // react-select shows the chosen option in a "single value" element beside the input's own box.
      return Boolean(
        pickBox(handle.element)?.querySelector('[class*="single-value"], [class*="multi-value"]'),
      );
    }
    case 'dateParts':
      return handle.year.value.trim() !== '';
    case 'prompt':
      return Boolean(
        handle.element
          .closest('[data-automation-id="multiSelectContainer"]')
          ?.querySelector('[data-automation-id="selectedItem"]'),
      );
    case 'buttons':
      return handle.buttons.some(pressed);
  }
}

/**
 * Names fields by their control, so a field keeps its id when the page is read again and a question that appeared
 * in between gets a new one.
 */
export function fieldIds(): (control: Element) => string {
  const known = new WeakMap<Element, string>();
  let next = 0;
  return (control) => {
    let id = known.get(control);
    if (id === undefined) {
      id = `f${++next}`;
      known.set(control, id);
    }
    return id;
  };
}

/**
 * Finds the form's fields: labels, kinds, choices, and whether they're required. Adapters add what the generic
 * pass can't see (button groups, custom dropdowns) and name fields the page identifies outright.
 */
export function extractFields(
  adapter: Adapter,
  doc: Document,
  frameId: number,
  idOf: (control: Element) => string = fieldIds(),
): Extraction {
  const fields: ScannedField[] = [];
  const handles = new Map<string, Handle>();
  const anchors = new Map<string, Element>();
  const form = adapter.form(doc);
  if (!form) return { fields, handles, anchors };

  const covered = new Set<Element>();
  const add = (field: Omit<ScannedField, 'id'>, handle: Handle, anchor: Element) => {
    const id = `${frameId}:${idOf(controlsOf(handle)[0] ?? anchor)}`;
    fields.push({ id, ...field });
    handles.set(id, handle);
    anchors.set(id, anchor);
  };

  for (const custom of adapter.custom?.(form) ?? []) {
    addCustom(custom);
    for (const element of controlsOf(custom.handle)) covered.add(element);
  }

  function addCustom(custom: CustomField) {
    add(
      {
        label: clean(custom.label),
        description: custom.description ?? '',
        kind: custom.kind,
        options: custom.options,
        required: custom.required,
        hint: custom.hint ?? null,
        section: sectionOf(custom.anchor),
        entry: custom.entry ?? null,
        filled: custom.filled ?? isFilled(custom.handle),
        maxLength: null,
      },
      custom.handle,
      custom.anchor,
    );
  }

  const groups = new Map<string, HTMLInputElement[]>();
  const controls = [
    ...form.querySelectorAll<HTMLElement>('input, select, textarea, [role="combobox"]:not(input)'),
  ];
  for (const control of controls) {
    if (covered.has(control) || adapter.skip?.(control)) continue;
    const name = control.getAttribute('name') ?? '';
    const id = control.getAttribute('id') ?? '';
    if (CAPTCHA.test(name) || CAPTCHA.test(id) || /requiredInput/.test(control.className)) continue;

    if (control instanceof HTMLInputElement) {
      const type = control.type.toLowerCase();
      if (IGNORED_TYPES.has(type) || control.disabled) continue;
      if (type === 'radio' || type === 'checkbox') {
        // Radios group by name. Checkboxes group by their fieldset: Ashby names each box after its option.
        const box =
          control.closest('fieldset, [role="group"]') ??
          control.closest('[class*="checkbox-group"]:not([class*="option"])');
        const key =
          type === 'radio' || !box
            ? `${type}:${name || containerKey(control.closest('ul, li, div'))}`
            : `${type}:#${containerKey(box)}`;
        groups.set(key, [...(groups.get(key) ?? []), control]);
        continue;
      }
      if (type === 'file') {
        const label = labelOf(control);
        add(
          {
            label: fileLabel(control, label),
            description: '',
            kind: 'file',
            options: [],
            required: isRequired(control, label),
            hint: adapter.hint?.(control) ?? null,
            section: sectionOf(control),
            entry: adapter.entry?.(control) ?? null,
            filled: attachedFile(control) !== null,
            maxLength: null,
          },
          { type: 'file', element: control },
          control.parentElement ?? control,
        );
        continue;
      }
      if (control.readOnly || isHidden(control)) continue;
    } else if (control instanceof HTMLTextAreaElement) {
      if (control.disabled || control.readOnly || isHidden(control)) continue;
    } else if (control instanceof HTMLSelectElement) {
      if (control.disabled || isHidden(control)) continue;
    } else if (isHidden(control)) {
      continue;
    }

    const kind = adapter.kind?.(control) ?? kindOf(control);
    if (!kind) continue;
    const label = labelOf(control);
    const handle: Handle =
      kind === 'select' || (kind === 'multi' && control instanceof HTMLSelectElement)
        ? { type: 'select', element: control as HTMLSelectElement }
        : kind === 'combobox'
          ? { type: 'combobox', element: control }
          : kind === 'typeahead'
            ? { type: 'typeahead', element: control as HTMLInputElement }
            : { type: 'input', element: control as HTMLInputElement | HTMLTextAreaElement };
    const options =
      control instanceof HTMLSelectElement
        ? [...control.options]
            .filter(
              (option, index) =>
                !(index === 0 && (option.value === '' || /select|choose|--/i.test(option.text))),
            )
            .map((option) => clean(option.text))
        : [];
    const maxLength =
      control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
        ? control.maxLength > 0
          ? control.maxLength
          : null
        : null;
    add(
      {
        label,
        description: descriptionOf(control),
        kind,
        options,
        required: isRequired(control, label),
        hint: adapter.hint?.(control) ?? null,
        section: sectionOf(control),
        entry: adapter.entry?.(control) ?? null,
        filled: isFilled(handle),
        maxLength,
      },
      handle,
      questionContainer(control) ?? control,
    );
  }

  for (const [key, inputs] of groups) {
    const first = inputs[0];
    if (!first) continue;
    const radio = key.startsWith('radio:');
    const options = inputs.map(choiceLabel);
    const label = groupLabel(inputs) || (inputs.length === 1 ? (options[0] ?? '') : '');
    const handle: Handle = radio
      ? { type: 'radio', inputs }
      : inputs.length === 1
        ? { type: 'checkbox', element: first }
        : { type: 'multi', inputs };
    const kind: FieldKind = radio ? 'radio' : inputs.length === 1 ? 'checkbox' : 'multi';
    add(
      {
        label,
        description: descriptionOf(first),
        kind,
        options: kind === 'checkbox' ? [] : options,
        required: inputs.some((input) => isRequired(input, label)),
        hint: adapter.hint?.(first) ?? null,
        section: sectionOf(first),
        entry: adapter.entry?.(first) ?? null,
        filled: isFilled(handle),
        maxLength: null,
      },
      handle,
      questionContainer(first) ?? first,
    );
  }

  return { fields, handles, anchors };
}

const containerIds = new WeakMap<Element, number>();
let lastContainerId = 0;

/** A stable key for an element within this extraction, for grouping the checkboxes inside it. */
function containerKey(element: Element | null): string {
  if (!element) return 'none';
  let id = containerIds.get(element);
  if (id === undefined) {
    id = ++lastContainerId;
    containerIds.set(element, id);
  }
  return String(id);
}

function kindOf(control: HTMLElement): FieldKind | null {
  if (control instanceof HTMLTextAreaElement) return 'textarea';
  if (control instanceof HTMLSelectElement) return control.multiple ? 'multi' : 'select';
  if (control.getAttribute('role') === 'combobox') return 'combobox';
  if (control instanceof HTMLInputElement) return TEXT_TYPES[control.type.toLowerCase()] ?? 'text';
  return null;
}

/** "Attach" buttons label the file input; the question is the upload group's label. */
function fileLabel(input: HTMLInputElement, label: string): string {
  if (label && !/^(attach|upload|browse|choose file|select file|drop files?)/i.test(label)) return label;
  const group = input.closest('[role="group"], .field, .application-question, fieldset, [class*="upload"]');
  const labelledBy = group?.getAttribute('aria-labelledby');
  const named = labelledBy ? textOf(input.ownerDocument.getElementById(labelledBy)) : '';
  return named || (group ? questionText(group) : '') || label;
}

export function controlsOf(handle: Handle): Element[] {
  switch (handle.type) {
    case 'radio':
    case 'multi':
      return handle.inputs;
    case 'buttons':
      return handle.buttons;
    case 'dateParts':
      return [handle.month, handle.day, handle.year].filter(
        (part): part is HTMLInputElement => part !== null,
      );
    default:
      return [handle.element];
  }
}
