import type { Answer, FieldKind, FieldStatus, ScannedField, Want } from '../model';
import { pickOption } from './options';

/** What a rule decided for one field. */
export interface Resolution {
  status: FieldStatus;
  answer: Answer | null;
  key: string;
  note: string | null;
  critical: boolean;
}

const TEXT_KINDS: readonly FieldKind[] = ['text', 'textarea', 'email', 'tel', 'url', 'number', 'typeahead'];
const CHOICE_KINDS: readonly FieldKind[] = ['select', 'combobox', 'radio'];

export const isTextKind = (kind: FieldKind) => TEXT_KINDS.includes(kind);
export const isChoiceKind = (kind: FieldKind) => CHOICE_KINDS.includes(kind);

interface Options {
  status?: FieldStatus;
  note?: string | null;
  critical?: boolean;
}

export function done(key: string, answer: Answer, options: Options = {}): Resolution {
  return {
    status: options.status ?? 'filled',
    answer,
    key,
    note: options.note ?? null,
    critical: options.critical ?? false,
  };
}

/** Left empty on purpose (an optional cover letter), or empty because the profile has nothing (then `missing`). */
export function empty(
  key: string,
  field: ScannedField,
  note: string | null = null,
  critical = false,
): Resolution {
  return { status: field.required || critical ? 'missing' : 'skipped', answer: null, key, note, critical };
}

/**
 * A choice, resolved now when the field shows its options. With options known and none matching, the field is
 * left for the owner rather than guessed.
 */
export function choose(key: string, field: ScannedField, want: Want, options: Options = {}): Resolution {
  if (field.options.length > 0) {
    const option = pickOption(field.options, want);
    // An option can be the empty string: a lone checkbox with no text of its own.
    if (option === null) return empty(key, field, options.note ?? 'no matching option', options.critical);
    return done(key, { type: 'choice', want, option }, options);
  }
  return done(key, { type: 'choice', want, option: null }, options);
}

/**
 * A text value that adapts to the field: typed into text fields, matched against options in choice fields,
 * joined for multi-selects. Empty values leave the field empty.
 */
export function text(
  key: string,
  field: ScannedField,
  value: string,
  alternatives: string[] = [],
  options: Options = {},
): Resolution {
  if (!value) return empty(key, field, options.note ?? null, options.critical);
  if (isTextKind(field.kind)) return done(key, { type: 'text', text: value }, options);
  if (field.kind === 'multi') return done(key, { type: 'choices', texts: [value, ...alternatives] }, options);
  if (isChoiceKind(field.kind))
    return choose(key, field, { kind: 'like', texts: [value, ...alternatives] }, options);
  if (field.kind === 'date') return empty(key, field, options.note ?? null, options.critical);
  return done(key, { type: 'text', text: value }, options);
}

/** A yes or no that adapts to the field: a checkbox, a choice, or the word in a text field. */
export function yesNo(key: string, field: ScannedField, yes: boolean, options: Options = {}): Resolution {
  if (field.kind === 'checkbox') return done(key, { type: 'check', checked: yes }, options);
  if (isTextKind(field.kind)) return done(key, { type: 'text', text: yes ? 'Yes' : 'No' }, options);
  if (field.kind === 'multi') {
    // Boxes labeled "Yes" and "No" work like a choice; a lone box is ticked only for yes.
    const hasNo = field.options.some((option) => /^no\b/i.test(option.trim()));
    if (yes || hasNo) return choose(key, { ...field, kind: 'radio' }, { kind: yes ? 'yes' : 'no' }, options);
    return empty(key, field, options.note ?? null);
  }
  return choose(key, field, { kind: yes ? 'yes' : 'no' }, options);
}

export function several(
  key: string,
  field: ScannedField,
  values: string[],
  options: Options = {},
): Resolution {
  if (values.length === 0) return empty(key, field, options.note ?? null);
  if (field.kind === 'multi') return done(key, { type: 'choices', texts: values }, options);
  return text(key, field, values.join(', '), [], options);
}

export function date(
  key: string,
  field: ScannedField,
  iso: string,
  fallbackText: string,
  options: Options = {},
): Resolution {
  if (field.kind === 'date') return done(key, { type: 'date', iso }, options);
  return text(key, field, fallbackText, [], options);
}

export function file(key: string, resumeId: string | null, field: ScannedField): Resolution {
  if (!resumeId) return empty(key, field, 'no resume PDF on Outbox');
  return done(key, { type: 'file', resumeId });
}
