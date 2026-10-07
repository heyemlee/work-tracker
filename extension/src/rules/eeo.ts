import type { EeoField, Want } from '../model';
import type { Profile } from '../profile/schema';
import { leads, norm } from '../text';
import { DECLINE } from './patterns';

/** Voluntary self-identification questions: US EEO categories plus the optional ones some forms add. */
export function classifyEeo(label: string): EeoField | null {
  const text = norm(label);
  if (/sexual orientation/.test(text)) return 'orientation';
  if (/transgender|\btrans\b/.test(text)) return 'transgender';
  if (/veteran/.test(text)) return 'veteran';
  if (/disabilit/.test(text)) return 'disability';
  if (/hispanic|latin[oax]/.test(text) && !/\brace\b/.test(text)) return 'hispanic';
  if (/\brace\b|ethnicit|racial/.test(text)) return 'race';
  if (/\bgender\b|^sex$|\bsex\b/.test(text) && !/pronoun/.test(text)) return 'gender';
  return null;
}

export function eeoWant(field: EeoField, profile: Profile): Want {
  const eeo = profile.eeo;
  const value: Record<EeoField, string> = {
    gender: eeo.gender,
    hispanic: eeo.hispanic,
    race: eeo.race,
    veteran: eeo.veteran,
    disability: eeo.disability,
    orientation: eeo.orientation,
    transgender: 'decline',
  };
  return { kind: 'eeo', field, value: value[field] };
}

const RACE: Record<string, RegExp> = {
  asian: /\basian\b/,
  black: /\bblack\b|african american/,
  white: /\bwhite\b/,
  'native-american': /american indian|alaska(n)? native|native american|indigenous/,
  'pacific-islander': /hawaiian|pacific islander/,
  'two-or-more': /two or more|multiracial|multiple races|mixed/,
};

// Forms say "Heterosexual" or "Straight", "Gay or lesbian" or "Homosexual".
const ORIENTATION: Record<string, RegExp> = {
  heterosexual: /\b(heterosexual|straight)\b/,
  gay: /\b(gay|lesbian|homosexual)\b/,
  bisexual: /\bbisexual\b/,
};

/** The option for an EEO answer; "decline" picks whichever wording the form uses for it. */
export function pickEeoOption(options: readonly string[], field: EeoField, value: string): string | null {
  const find = (test: (text: string) => boolean) => options.find((option) => test(norm(option))) ?? null;
  if (value === 'decline') return find((text) => DECLINE.test(text) || /^i do not want to answer/.test(text));
  switch (field) {
    case 'gender':
      if (value === 'male')
        return find((text) => /^(male|man|men|cis ?male|cisgender (male|man))\b/.test(text));
      if (value === 'female')
        return find((text) => /^(female|woman|women|cis ?female|cisgender (female|woman))\b/.test(text));
      if (value === 'nonbinary')
        return find((text) => /non ?binary|genderqueer|gender non ?conforming/.test(text));
      return null;
    case 'hispanic':
      if (value === 'yes') return find((text) => leads(text, 'yes') || /^hispanic or latin/.test(text));
      return find((text) => leads(text, 'no') || /^not hispanic/.test(text));
    case 'race': {
      const pattern = RACE[value];
      return pattern ? find((text) => pattern.test(text) && !DECLINE.test(text)) : null;
    }
    case 'veteran':
      // Workday's "I identify as a veteran, just not a protected veteran" is a yes.
      if (value === 'not')
        return find(
          (text) =>
            !/identify as a veteran|i am a veteran/.test(text) &&
            /not a (protected )?veteran|i am not (a )?(protected )?veteran|^no\b/.test(text),
        );
      return find(
        (text) =>
          !/\bnot\b/.test(text) &&
          (/protected veteran|identify as (one or more|a veteran)|i am a veteran/.test(text) ||
            leads(text, 'yes')),
      );
    case 'disability':
      if (value === 'no')
        return find((text) => /^no\b|do not have a disability|don t have a disability/.test(text));
      return find(
        (text) => /^yes\b|i have a disability|have had one/.test(text) && !/do not|don t/.test(text),
      );
    case 'orientation': {
      const pattern = ORIENTATION[value];
      return pattern ? find((text) => pattern.test(text) && !/\bnot\b/.test(text)) : null;
    }
    case 'transgender':
      return null;
  }
}
