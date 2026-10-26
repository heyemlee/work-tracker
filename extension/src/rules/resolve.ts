import type { Answer, FieldKind, FieldStatus, ScannedField, Want } from '../model';
import { norm, words } from '../text';
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

const DATE_WORDS = new Set(['start', 'end', 'date', 'from', 'to', 'day', 'month', 'year', 'dd', 'mm', 'yyyy']); // prettier-ignore

/**
 * A label of a date's words alone, "End date year", "Start month", "From", says nothing of whose date it asks: a
 * job's, a school's, the one beside it. Its entry answers it (an adapter that numbers the jobs) or the owner does.
 */
export function onlyDate(label: string): boolean {
  const all = words(label);
  return all.length > 0 && all.every((word) => DATE_WORDS.has(word));
}

const MONTH =
  /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?|0?[1-9]|1[0-2])$/;

/**
 * Whether the field can take the answer as it stands. One it can't was meant for another question: "one week after
 * an offer" cut to a year's four characters, a job's title for the "Current role" box (Lyft, 2026-10-23). Such a
 * field is left for the owner, as any the rules can't be sure of: a wrong answer is worse than none.
 */
export function fits(field: ScannedField, answer: Answer): boolean {
  if (answer.type === 'text' && field.maxLength !== null && answer.text.trim().length > field.maxLength)
    return false;
  if (field.kind === 'checkbox')
    return answer.type !== 'text' || /^(yes|no|true|false)$/i.test(answer.text.trim());
  if (answer.type === 'date' || !onlyDate(field.label)) return true;
  // A year or a month alone takes a year or a month.
  const label = words(field.label);
  const part = label.includes('year') ? 'year' : label.includes('month') ? 'month' : null;
  if (!part || (label.includes('year') && label.includes('month'))) return true;
  const texts =
    answer.type === 'text'
      ? [answer.text]
      : answer.type === 'choice'
        ? answer.option !== null
          ? [answer.option]
          : answer.want.kind === 'like'
            ? answer.want.texts
            : []
        : answer.type === 'choices'
          ? answer.texts
          : [];
  return texts.some((text) => (part === 'year' ? /^\d{4}$/.test(text.trim()) : MONTH.test(norm(text))));
}

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
 * A text value that adapts to the field: typed into text fields, matched against options in choice fields. A group
 * of boxes takes it as a dropdown does, in one box: the alternatives are the answer's other names ("US" for the
 * United States), not answers of their own. Empty values leave the field empty, and so does a lone box, which takes a
 * yes or a no and not a name.
 */
export function text(
  key: string,
  field: ScannedField,
  value: string,
  alternatives: string[] = [],
  options: Options = {},
): Resolution {
  if (!value || field.kind === 'checkbox') return empty(key, field, options.note ?? null, options.critical);
  if (isTextKind(field.kind)) return done(key, { type: 'text', text: value }, options);
  if (isChoiceKind(field.kind) || field.kind === 'multi')
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
