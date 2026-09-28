import type { Want } from '../model';
import { findOption, leads, norm } from '../text';
import { pickAuthOption } from './authorization';
import { pickEeoOption } from './eeo';
import { DECLINE } from './patterns';

const AFFIRM =
  /^(yes|i agree|agree|i acknowledge|acknowledged?|acknowledge confirm|i confirm|confirmed?|i understand|understood|i consent|consent|i certify|i accept|accept|i have read|ok|okay)\b/;

const NEGATIVE =
  /^(no|i have not|i haven t|i have never|i ve never|i never|i do not|i don t|i am not|i m not|i was not|never|none|not )\b/;

/** The option that answers `want`, or null when none clearly does. */
export function pickOption(options: readonly string[], want: Want): string | null {
  if (options.length === 0) return null;
  switch (want.kind) {
    case 'yes':
      return exactly(options, 'yes') ?? options.find((option) => leads(option, 'yes')) ?? null;
    case 'no':
      return (
        exactly(options, 'no') ??
        options.find((option) => leads(option, 'no')) ??
        options.find((option) => NEGATIVE.test(norm(option))) ??
        null
      );
    case 'decline':
      return options.find((option) => DECLINE.test(norm(option))) ?? null;
    case 'like':
      return findOption(options, want.texts);
    case 'affirm': {
      if (options.length === 1) return options[0] ?? null;
      return (
        exactly(options, 'yes') ??
        options.find((option) => AFFIRM.test(norm(option)) && !NEGATIVE.test(norm(option))) ??
        null
      );
    }
    case 'range':
      return pickRange(options, want.value);
    case 'eeo':
      return pickEeoOption(options, want.field, want.value);
    case 'auth':
      return pickAuthOption(options, want.question);
  }
}

function exactly(options: readonly string[], word: string): string | null {
  return options.find((option) => norm(option) === word) ?? null;
}

/**
 * "0-1 years", "1-2", "3-5 years", "6+", "Less than 1 year", "10 or more years": the one containing `value`.
 * Years are whole, so 2.8 years counts as 2. Where ranges share an end ("1-2", "2-3"), 2 belongs to the one it
 * starts: two full years is past "1-2".
 */
export function pickRange(options: readonly string[], value: number): string | null {
  const years = Math.floor(value);
  let best: { option: string; from: number } | null = null;
  for (const option of options) {
    const text = norm(option);
    const numbers = [...text.matchAll(/\d+/g)].map((match) => Number(match[0]));
    const [first, second] = numbers;
    if (first === undefined) continue;
    const contains = /less than|under|fewer than|below/.test(text)
      ? years < first
      : /\+|or more|more than|over|at least|and above|plus/.test(text) && second === undefined
        ? years >= first
        : second !== undefined
          ? years >= first && years <= second
          : years === first;
    if (contains && (!best || first > best.from)) best = { option, from: first };
  }
  return best?.option ?? null;
}
