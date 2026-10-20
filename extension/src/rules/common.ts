import { addDays } from '@domain/dates';
import type { FieldKind, ScannedField } from '../model';
import {
  authFacts,
  cityState,
  fullName,
  interviewedAt,
  isUnitedStates,
  latestEducation,
  latestJob,
  preferredFirst,
  preferredFull,
  workedAt,
  yearsOfExperience,
} from '../profile/profile';
import type { Education } from '../profile/schema';
import { norm } from '../text';
import { postingCountry } from './authorization';
import type { RuleContext } from './context';
import { isLocal, metroOf, stateNames } from './geo';
import { pickOption, pickRange } from './options';
import {
  choose,
  date,
  done,
  empty,
  file,
  isChoiceKind,
  isTextKind,
  several,
  text,
  yesNo,
  type Resolution,
} from './resolve';

/**
 * The field dictionary: standard fields and the questions most forms repeat, answered from the profile. Rules are
 * tried in order against the normalized label; the first that matches answers, even if it leaves the field empty.
 */
export interface Rule {
  key: string;
  test: RegExp;
  not?: RegExp;
  kinds?: readonly FieldKind[];
  answer: (field: ScannedField, ctx: RuleContext) => Resolution;
}

const DEGREE_NAMES: Record<Education['level'], string[]> = {
  'high-school': ['High School Diploma', 'High School', 'GED'],
  associate: ["Associate's Degree", 'Associate Degree', 'Associate'],
  bachelor: ["Bachelor's Degree", 'Bachelors Degree', "Bachelor's", 'Bachelor', 'BS', 'BA', 'Undergraduate'],
  master: ["Master's Degree", 'Masters Degree', "Master's", 'Master', 'MS', 'Graduate'],
  doctorate: ['Doctorate', 'PhD', 'Ph D', 'Doctor of Philosophy'],
  other: ['Other'],
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']; // prettier-ignore

/**
 * Of options that name dates ("Monday, October 12th"), the first on or after `from` (YYYY-MM-DD). A date without a
 * year is the next one after `today`.
 */
function firstDateFrom(options: readonly string[], from: string, today: string): string | null {
  const dated = options.flatMap((option) => {
    const match =
      /\b(january|february|march|april|may|june|july|august|september|october|november|december) (\d{1,2})(?:st|nd|rd|th)?\b(?: (\d{4}))?/.exec(
        norm(option),
      );
    if (!match) return [];
    const month = MONTHS.indexOf(match[1]!) + 1;
    const day = Number(match[2]);
    const pad = (value: number) => String(value).padStart(2, '0');
    let year = match[3] ? Number(match[3]) : Number(today.slice(0, 4));
    if (!match[3] && `${year}-${pad(month)}-${pad(day)}` < today) year++;
    return [{ option, iso: `${year}-${pad(month)}-${pad(day)}` }];
  });
  if (dated.length === 0) return null;
  return (
    dated.filter((entry) => entry.iso >= from).sort((a, b) => a.iso.localeCompare(b.iso))[0]?.option ?? null
  );
}

export const LANGUAGE_NAMES = ['english', 'mandarin', 'chinese', 'cantonese', 'spanish', 'french', 'german', 'japanese', 'korean', 'arabic', 'hindi', 'portuguese', 'italian', 'russian', 'dutch', 'hebrew', 'vietnamese', 'turkish', 'polish', 'swedish', 'norwegian', 'danish', 'finnish', 'greek', 'thai', 'indonesian', 'malay', 'tagalog', 'urdu', 'bengali', 'punjabi', 'tamil', 'telugu', 'persian', 'farsi', 'ukrainian', 'czech', 'romanian', 'hungarian']; // prettier-ignore

// The longest name first: a bare "United States" also matches "United States Minor Outlying Islands", which sorts
// ahead of "United States of America" in Workday's lists. An exact "United States" still matches on its turn.
const COUNTRY_US = ['United States of America', 'United States', 'USA', 'US', 'U.S.', 'America'];

// Other countries a list may name in short, as Stripe's does ("UK", "UAE"): each under its names, the full one first.
const COUNTRY_NAMES = [
  ['United Kingdom', 'UK', 'U.K.', 'Great Britain'],
  ['United Arab Emirates', 'UAE', 'U.A.E.'],
];

const HEARD_SYNONYMS: Record<string, string[]> = {
  // Without a LinkedIn option, a job board is what LinkedIn is; the company's own site isn't.
  linkedin: [
    'LinkedIn',
    'LinkedIn Jobs',
    'LinkedIn Job Posting',
    'Linkedin',
    'Job Board',
    'Online Job Board',
  ],
  'company website': [
    'Company Website',
    'Career Page',
    'Careers Page',
    'Career Site',
    'Careers Site',
    'Company Careers Page',
    'Careers Website',
    'Our website',
    'Website',
    'Job Board',
    'Online Job Board',
  ],
};

const month = (value: string | null) => {
  if (!value) return '';
  const [year, number] = value.split('-');
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[Number(number) - 1] ?? ''} ${year}`.trim();
}; // prettier-ignore

const SEASON_MONTHS: Record<string, number[]> = {
  spring: [1, 2, 3, 4, 5, 6],
  summer: [6, 7, 8],
  fall: [8, 9, 10, 11, 12],
  autumn: [8, 9, 10, 11, 12],
  winter: [12, 1, 2],
};

/** "Fall" → its months, "June" → [6], none → the whole year. */
const termMonths = (word: string | undefined): number[] =>
  !word ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : (SEASON_MONTHS[word] ?? [MONTHS.indexOf(word) + 1]);

/**
 * A yes-or-no question naming when a graduation must fall ("I confirm that my graduation date will be either Fall
 * 2026 or Spring 2027", "between May 2026 and June 2027"), answered from the graduation month ("2025-06"). Null
 * when the field isn't one.
 */
function graduatesInNamedTerms(field: ScannedField, end: string): boolean | null {
  const label = norm(field.label);
  const terms = [
    ...label.matchAll(
      new RegExp(`\\b(?:(${[...Object.keys(SEASON_MONTHS), ...MONTHS].join('|')}) )?(20\\d\\d)\\b`, 'g'),
    ),
  ].map((match) => ({ months: termMonths(match[1]), year: Number(match[2]) }));
  if (terms.length === 0) return null;
  const hasYesNo = field.options.some((option) => /^(yes|no)\b/.test(norm(option)));
  const asksToConfirm =
    field.kind === 'checkbox' ||
    hasYesNo ||
    (field.options.length === 0 &&
      isChoiceKind(field.kind) &&
      /^(i confirm|i certify|are you|will you|do you|is your|can you)\b/.test(label));
  if (!asksToConfirm) return null;
  const at = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7));
  const [from, to] = terms;
  if (/\bbetween\b/.test(label) && from && to && terms.length === 2) {
    return at >= from.year * 12 + Math.min(...from.months) && at <= to.year * 12 + Math.max(...to.months);
  }
  return terms.some((term) => term.months.some((month) => term.year * 12 + month === at));
}

/** Skills and domains: a years-of-experience question naming one needs judgment, not arithmetic. */
const SKILL_WORDS =
  /python|java\b|javascript|typescript|react|\bgo\b|golang|c\+\+|\bc\b|rust|ruby|kotlin|swift|kubernetes|terraform|aws|gcp|azure|sql|machine learning|\bml\b|embedded|firmware|hardware|security|leadership|management|managing|infrastructure|devops|frontend|backend|mobile|ios|android|data|design|sales|with |in (a|an|the) /;

/** Whether the place a "Are you based in …?" question names is where the applicant lives; null if unsure. */
function livesIn(question: string, ctx: RuleContext): boolean | null {
  const place = question.replace(
    /^(are you|do you) (currently )?(based|located|living|live|reside|residing)( and work)? in (the )?/,
    '',
  );
  const { address } = ctx.profile;
  const homeMetro = metroOf(address.city);
  if (homeMetro && metroOf(place) === homeMetro) return true;
  if (address.city && new RegExp(`(^| )${norm(address.city)}( |$)`).test(place)) return true;
  if (stateNames(address.state).some((name) => new RegExp(`(^| )${norm(name)}( |$)`).test(place)))
    return true;
  if (/^(us|u s|usa|united states|america)\b/.test(place)) return isUnitedStates(address.country);
  if (
    metroOf(place) ||
    /european union|\beu\b|europe|canada|uk|united kingdom|india|australia|new zealand|bangalore|london|toronto|berlin|amsterdam|dublin|singapore|tokyo/.test(
      place,
    )
  )
    return false;
  return null;
}

/** Places outside the US a question may name; relocating or commuting there is the owner's call. */
const ABROAD =
  /\b(canada|toronto|montreal|vancouver|mexico|brazil|sao paulo|uk|u k|united kingdom|london|ireland|dublin|europe|european union|\beu\b|emea|germany|berlin|munich|netherlands|amsterdam|france|paris|spain|madrid|barcelona|portugal|lisbon|poland|warsaw|krakow|switzerland|zurich|sweden|stockholm|denmark|copenhagen|israel|tel aviv|middle east|dubai|uae|india|bengaluru|bangalore|hyderabad|pune|singapore|japan|tokyo|korea|seoul|china|beijing|shanghai|shenzhen|hong kong|taiwan|taipei|australia|sydney|melbourne|new zealand|apac|latam)\b/;

const abroad = (label: string) => ABROAD.test(norm(label));

/** The posting itself is outside the US: "Tokyo, Japan", "Stockholm / London", "EMEA". Remote ones aren't. */
const abroadPosting = (ctx: RuleContext) => {
  const location = ctx.posting?.location ?? '';
  if (/\bremote\b/i.test(location)) return false;
  const country = postingCountry(location);
  return country ? !isUnitedStates(country) : ABROAD.test(norm(location));
};

/** The hiring company, for "have you worked at X?" questions. */
const company = (ctx: RuleContext) => ctx.posting?.company ?? '';

/** The names a list may have for a country, in the order to look for them; a country of one name, that name. */
function countryNames(country: string): string[] {
  if (isUnitedStates(country)) return COUNTRY_US;
  const name = norm(country);
  return COUNTRY_NAMES.find((names) => names.some((other) => norm(other) === name)) ?? [country];
}

/**
 * The applicant's country: typed, the profile's own spelling; from a list, the first of its names the list has,
 * a dropdown's options and a group of boxes alike. A list that has none of them as an option is looked through
 * for a full name as words of an option, never a short one: "America" is in "Latin America", "U.S." in "U.S. Virgin
 * Islands", and neither is the country.
 */
function ownCountry(key: string, field: ScannedField, ctx: RuleContext): Resolution {
  const country = ctx.profile.address.country;
  if (isTextKind(field.kind)) return text(key, field, country);
  const names = countryNames(country);
  const named = field.options.find((option) => names.some((name) => norm(name) === norm(option)));
  if (named) return text(key, field, named);
  const full = field.options.length ? names.filter((name) => /\s/.test(name.trim())) : names;
  const [name = country, ...others] = full.length ? full : [country];
  return text(key, field, name, others);
}

function relocationChoice(field: ScannedField, ctx: RuleContext, willing: boolean): Resolution | null {
  // Options like "Yes, I live here" / "Yes, I plan to relocate" / "No": pick by where the posting is.
  const local = isLocal(ctx.posting?.location ?? null, ctx.profile.address.city);
  const options = field.options.map((option) => ({ option, text: norm(option) }));
  const here = options.find(
    ({ text }) =>
      /\b(live|located|based|reside) (here|nearby|in the area)|currently (located|live|based)|already (live|located)|i m located|within commuting/.test(
        text,
      ) && !/^no\b/.test(text),
  );
  const moving = options.find(
    ({ text }) =>
      /relocat|plan to move|will move|willing to move/.test(text) && !/^no\b|not willing/.test(text),
  );
  if (!here || !moving) return null;
  if (local === true) return choose('relocation', field, { kind: 'like', texts: [here.option] });
  if (local === false && willing)
    return choose('relocation', field, { kind: 'like', texts: [moving.option] });
  return empty('relocation', field, 'where the posting is');
}

export const RULES: readonly Rule[] = [
  // "If you answered yes, please explain": answered only when the form insists.
  {
    key: 'followUp',
    test: /^(if (you answered|you selected|you chose|yes|so|applicable|other)\b|if you (currently|previously) (work|worked))/,
    not: /\bopt\b|optional practical/,
    kinds: ['text', 'textarea'],
    answer: (field) => (field.required ? text('followUp', field, 'N/A') : empty('followUp', field)),
  },
  // Files.
  {
    key: 'resume',
    test: /resume|\bcv\b|curriculum vitae/,
    kinds: ['file'],
    answer: (field, ctx) => file('resume', ctx.resumeId, field),
  },
  {
    key: 'coverLetter',
    test: /cover letter|motivation letter/,
    kinds: ['file'],
    answer: (field) => empty('coverLetter', field, 'cover letter'),
  },
  { key: 'file', test: /./, kinds: ['file'], answer: (field) => empty('file', field, 'attachment') },

  // A reference's name, title, phone and email are someone else's: never the owner's.
  {
    key: 'reference',
    test: /\breferences?\b/,
    not: /reference (number|code|no|id)\b|(job|posting|requisition) reference/,
    kinds: ['text', 'textarea', 'email', 'tel'],
    answer: (field) => empty('reference', field),
  },

  // Names.
  {
    key: 'name.legalIfDifferent',
    test: /if different|legal name \(if|former name|maiden name|other names/,
    answer: (field) => empty('name.legalIfDifferent', field),
  },
  {
    key: 'name.preferredLast',
    test: /preferred (last|family) name|preferred surname/,
    answer: (field, ctx) => text('name.preferredLast', field, ctx.profile.name.last),
  },
  {
    key: 'name.preferred',
    test: /preferred (first )?name|preferred full name|what (would you like|should we|do you want us to) (us to )?call you|nick ?name|name you (go by|prefer)|preferred first last name|goes by/,
    answer: (field, ctx) => {
      const { profile } = ctx;
      // Workday's "I have a preferred name" box opens the preferred name fields.
      if (field.kind === 'checkbox') return yesNo('name.preferred', field, Boolean(profile.name.preferred));
      if (!profile.name.preferred && !field.required) return empty('name.preferred', field);
      return text(
        'name.preferred',
        field,
        /full|last/.test(norm(field.label)) ? preferredFull(profile) : preferredFirst(profile),
      );
    },
  },
  {
    key: 'name.first',
    test: /^(legal )?first name|^given name|^first$|legal first name|^first name|what is your (legal )?first name/,
    answer: (field, ctx) => text('name.first', field, ctx.profile.name.first),
  },
  {
    key: 'name.last',
    test: /^(legal )?last name|^family name|^surname|legal last name|^last$|what is your (legal )?last name/,
    answer: (field, ctx) => text('name.last', field, ctx.profile.name.last),
  },
  {
    key: 'name.pronunciation',
    test: /pronunc|pronounc/,
    answer: (field, ctx) => text('name.pronunciation', field, ctx.profile.name.pronunciation),
  },
  {
    key: 'pronouns',
    test: /pronoun/,
    answer: (field, ctx) => {
      const pronouns = ctx.profile.name.pronouns;
      if (isTextKind(field.kind)) return text('pronouns', field, pronouns);
      return pronouns ? text('pronouns', field, pronouns) : choose('pronouns', field, { kind: 'decline' });
    },
  },
  {
    key: 'name.full',
    test: /^(full |legal |your |candidate )?name$|full name|legal name|first and last name|^name first and last|^name \(/,
    not: /company|employer|school|referr|preferred|pronunc|reference|university|manager|recruiter/,
    answer: (field, ctx) => text('name.full', field, fullName(ctx.profile)),
  },

  // Contact.
  {
    key: 'email',
    test: /^e ?mail|email address|your email|^contact email/,
    not: /\bme\b|alert|future|opening|update|opt|subscribe|newsletter/,
    answer: (field, ctx) => text('email', field, ctx.email),
  },
  {
    key: 'phone.country',
    test: /country (phone )?code|phone country|dial(l)?ing code|country phone|phone (number )?country/,
    answer: (field) =>
      // Not a bare "+1": Canada and much of the Caribbean share it.
      text('phone.country', field, 'United States of America (+1)', [
        'United States (+1)',
        'United States of America',
        'United States',
        'USA (+1)',
        'US (+1)',
        'USA',
        'US',
      ]),
  },
  {
    key: 'phone.type',
    test: /phone (device )?type|type of phone/,
    answer: (field) =>
      text('phone.type', field, 'Mobile', ['Cell', 'Cell Phone', 'Mobile Phone', 'Personal']),
  },
  // "Phone Extension" is an office line's; a mobile number has none, so it stays empty.
  {
    key: 'phone.extension',
    test: /\bext(ension)?\b/,
    not: /country|code/,
    kinds: ['text', 'tel', 'number'],
    answer: (field) => empty('phone.extension', field),
  },
  {
    key: 'phone',
    test: /^(phone|mobile|cell|telephone)|(phone|mobile|cell|contact) number|^your phone|^primary phone/,
    not: /type|code|whatsapp|\bsms\b|text messag|opt/,
    kinds: ['text', 'tel', 'number'],
    answer: (field, ctx) => text('phone', field, ctx.profile.phone),
  },

  // Links.
  {
    key: 'links.linkedin',
    test: /linked ?in/,
    answer: (field, ctx) => text('links.linkedin', field, ctx.profile.links.linkedin),
  },
  {
    key: 'links.github',
    test: /git ?hub/,
    answer: (field, ctx) =>
      text('links.github', field, ctx.profile.links.github || ctx.profile.links.website),
  },
  {
    key: 'links.twitter',
    test: /twitter|\bx (handle|profile|username|account)|\bx com\b/,
    answer: (field, ctx) => text('links.twitter', field, ctx.profile.links.twitter),
  },
  {
    key: 'links.website',
    test: /website|portfolio|personal (site|page)|\bblog\b|other (links?|urls?|websites?)|^links?$|^urls?$|online presence|content you ve created|project link|^url/,
    not: /company website|our website/,
    answer: (field, ctx) =>
      text('links.website', field, ctx.profile.links.website || ctx.profile.links.github),
  },

  // Where they are.
  {
    key: 'address.country',
    test: /^country$|country of residence|what country are you (currently )?(based|located|living|residing) in|country (you|do you) (live|reside)|current country|^country region|^location country|country where you (currently )?(live|reside)/,
    not: /code|citizenship|authori/,
    answer: (field, ctx) => ownCountry('address.country', field, ctx),
  },
  {
    key: 'address.state',
    test: /^state|state province|state or province|^province|province of residence|state of residence|^region$|which (u ?s )?state|state do you (currently )?(live|reside)/,
    not: /city/,
    answer: (field, ctx) => {
      const [first = '', ...rest] = stateNames(ctx.profile.address.state);
      // Canadian-province lists offer "Not in Canada" to everyone else.
      const outside = isUnitedStates(ctx.profile.address.country)
        ? [
            'Not in Canada',
            'Outside of Canada',
            'Outside Canada',
            'I do not live in Canada',
            'Not applicable',
            'N/A',
            'Other',
          ]
        : [];
      return text('address.state', field, first, [...rest, ...outside]);
    },
  },
  {
    key: 'address.zip',
    test: /zip|postal code|post code|postcode/,
    answer: (field, ctx) => text('address.zip', field, ctx.profile.address.zip),
  },
  {
    key: 'address.city',
    test: /^city$|^city town$|current city|city of residence/,
    answer: (field, ctx) => text('address.city', field, ctx.profile.address.city),
  },
  {
    key: 'address.plannedWork',
    test: /(address|location) from which you (plan|will|intend)|from where do you (intend|plan) to work|where (do|will) you (plan to )?work from/,
    answer: (field, ctx) => text('address.plannedWork', field, cityState(ctx.profile)),
  },
  {
    key: 'address.line1',
    test: /address( line)? ?1$|street address|^street/,
    not: /e ?mail|\bip\b/,
    answer: (field, ctx) => text('address.line1', field, ctx.profile.address.line1),
  },
  {
    key: 'address.full',
    test: /^(current |legal |home |mailing |residential |permanent |current legal )?address$|home address|mailing address|residential address|legal address/,
    not: /e ?mail|\bip\b|from which/,
    answer: (field, ctx) => {
      const { address } = ctx.profile;
      if (!address.line1) return empty('address.full', field, 'street address');
      return text(
        'address.full',
        field,
        `${address.line1}, ${address.city}, ${address.state} ${address.zip}`.trim(),
      );
    },
  },
  {
    key: 'address.inUs',
    test: /(currently )?(located|based|reside|residing|live|living)( and work)? in the (us|u s|united states)|are you (currently )?(in|within) the (us|u s|united states)|\bus based\b/,
    not: /\b(what|which|where)\b|city/,
    answer: (field, ctx) => yesNo('address.inUs', field, isUnitedStates(ctx.profile.address.country)),
  },
  {
    key: 'timezone',
    test: /time ?zone/,
    answer: (field, ctx) => {
      if (isTextKind(field.kind))
        return text(
          'timezone',
          field,
          isUnitedStates(ctx.profile.address.country) ? 'Pacific Time (PT)' : '',
        );
      return yesNo(
        'timezone',
        field,
        /\b(us|u s|america|pacific|pst|pt)\b/.test(norm(field.label)) &&
          isUnitedStates(ctx.profile.address.country),
      );
    },
  },
  {
    key: 'address.basedIn',
    test: /^(are you|do you) (currently )?(based|located|living|live|reside|residing)( and work)? in\b/,
    not: /relocat|willing/,
    answer: (field, ctx) => {
      const local = livesIn(norm(field.label), ctx);
      return local === null
        ? {
            status: field.required ? 'missing' : 'skipped',
            answer: null,
            key: 'unknown',
            note: null,
            critical: false,
          }
        : yesNo('address.basedIn', field, local);
    },
  },
  {
    key: 'location',
    test: /(current )?location|where are you (currently )?(located|based)|city and state|city state|where do you (currently )?live|place of residence/,
    not: /relocat|office|willing|open to|preferred|which of our|job location|work location|remote/,
    answer: (field, ctx) => {
      const { profile } = ctx;
      const states = stateNames(profile.address.state);
      if (isChoiceKind(field.kind)) {
        const us = isUnitedStates(profile.address.country);
        const alternatives = us
          ? [
              ...states.flatMap((state) => [`United States - ${state}`, `USA - ${state}`, `US - ${state}`]),
              ...states,
              ...COUNTRY_US,
            ]
          : [profile.address.country];
        return text('location', field, cityState(profile), alternatives);
      }
      return text('location', field, cityState(profile));
    },
  },

  // Moving and the office.
  {
    key: 'relocationAssistance',
    // "Do you require relocation?", not "If this role requires relocation:", which asks whether they'd move.
    test: /relocation (assistance|package|support|benefits?|bonus)|\byou (require|need) relocation/,
    answer: (field, ctx) => {
      const local = isLocal(ctx.posting?.location ?? null, ctx.profile.address.city);
      return local === true
        ? yesNo('relocationAssistance', field, false)
        : empty('relocationAssistance', field, 'relocation assistance');
    },
  },
  {
    key: 'relocation',
    test: /relocat/,
    answer: (field, ctx) => {
      if (abroad(field.label) || abroadPosting(ctx))
        return empty('relocation', field, 'relocating abroad', false);
      return (
        relocationChoice(field, ctx, ctx.profile.answers.relocate) ??
        yesNo(
          'relocation',
          field,
          ctx.profile.answers.relocate ||
            isLocal(ctx.posting?.location ?? null, ctx.profile.address.city) === true,
        )
      );
    },
  },
  {
    key: 'onsite',
    test: /in ?office|on ?site|in ?person (work|role|position|requirement|days|schedule|basis)|hybrid|office (days|schedule)|days (per|a|each) week|commute|(work|come|be) (in|from|into|to) (the |our |an )?(office|hq|headquarters)|(anchor|core) days|five days a week|monday (through |to )?friday|work from our|in ?person .{0,40}offices?|offices? .{0,40}% of the time/,
    not: /remote only|preferred|which office|events?\b/,
    answer: (field, ctx) => {
      if (abroad(field.label) || abroadPosting(ctx)) return empty('onsite', field, 'office abroad');
      return (
        relocationChoice(field, ctx, ctx.profile.answers.relocate) ??
        yesNo('onsite', field, ctx.profile.answers.onsite)
      );
    },
  },

  // Eligibility and history.
  {
    key: 'over18',
    test: /18 years|18\+|at least 18|over 18|18 or older|of legal (working )?age|age of majority/,
    answer: (field, ctx) => yesNo('over18', field, ctx.profile.answers.over18),
  },
  {
    key: 'governmentRelative',
    test: /(relative|family member|close relative|related to).*(government|public) official|(government|public) official.*(relative|family)/,
    answer: (field, ctx) =>
      yesNo('governmentRelative', field, ctx.profile.answers.relativeOfGovernmentOfficial),
  },
  {
    key: 'government',
    test: /government official|public official|government (entity|agency|employee)|worked for (a |the )?(u s |us )?government|(current|former) government/,
    answer: (field, ctx) => yesNo('government', field, ctx.profile.answers.governmentOfficial),
  },
  {
    key: 'conflict',
    test: /financial interest|close personal relationship|personal relationships?|(family members?|relatives?) .*(employ|work|relationship)|conflict of interest|referred .*(senior leader|decision ?maker|client)|institutional client/,
    answer: (field) => yesNo('conflict', field, false),
  },
  {
    key: 'nonCompete',
    test: /non ?compete|non ?solicit|restrictive covenant|post ?employment restriction|agreement with (a |your )?(former|current|previous|prior) employer|subject to any (agreement|restriction)|employment agreements? .*restrict/,
    answer: (field, ctx) => yesNo('nonCompete', field, ctx.profile.answers.nonCompete),
  },
  {
    key: 'interviewed',
    test: /interviewed (at|with|for)|previously interviewed|interview(ed)? (here|with us) before/,
    answer: (field, ctx) => yesNo('interviewed', field, interviewedAt(ctx.profile, company(ctx))),
  },
  {
    key: 'appliedBefore',
    test: /(previously|ever|already) applied|applied (to|at|with|for) .*(before|previously|in the past)|have you applied/,
    answer: (field, ctx) => yesNo('appliedBefore', field, ctx.appliedBefore),
  },
  {
    key: 'workedHere',
    test: /(previously|ever|currently|before|formerly|past)\b.*\b(employed|worked (at|for|with|by)|working (at|for)|work (at|for)|engaged by|consulted (at|for))|\b(employed|worked (at|for)|engaged)\b.*\b(in the past|before|previously)\b|have you (ever )?(been )?(worked|employed|engaged) (at|for|by)|former (employee|intern|contractor)|previous (employee|employment)|worked at .* before|work(ed)? for .* in the past/,
    not: /government/,
    answer: (field, ctx) => yesNo('workedHere', field, workedAt(ctx.profile, company(ctx))),
  },
  {
    key: 'contactEmployer',
    test: /contact (your )?(current|present) employer/,
    answer: (field, ctx) =>
      yesNo('contactEmployer', field, ctx.profile.answers.contactCurrentEmployer, { status: 'confirm' }),
  },
  {
    key: 'backgroundCheck',
    test: /background check|drug (test|screen)/,
    answer: (field) => yesNo('backgroundCheck', field, true),
  },
  {
    key: 'military',
    test: /\bare you (currently )?(serving )?(in|on|a member of) (the )?(u s |united states )?(reserves?|national guard|armed forces|military|active duty)\b/,
    not: /spouse|partner|dependent|family|child|parent|veteran/,
    answer: (field, ctx) => {
      // Serving in the US forces takes citizenship or a green card: someone on a visa isn't.
      const facts = authFacts(ctx.profile, 'United States');
      const onVisa =
        !facts.citizenOrResident && (facts.opt || facts.sponsorshipNow || facts.sponsorshipFuture);
      return onVisa ? yesNo('military', field, false) : empty('military', field);
    },
  },

  // Messages.
  {
    key: 'smsOptIn',
    test: /\bsms\b|text messag|whatsapp/,
    answer: (field, ctx) => yesNo('smsOptIn', field, ctx.profile.answers.smsOptIn),
  },
  {
    key: 'emailOptIn',
    test: /(email|e mail) me|future (job )?(openings|opportunities|roles|positions)|job alerts|join (our )?talent (community|network|pool)|talent (community|network)\b|keep (me )?(informed|updated|in touch)|receive (emails|updates|news)|marketing/,
    answer: (field, ctx) => yesNo('emailOptIn', field, ctx.profile.answers.emailOptIn),
  },
  {
    key: 'contactMethod',
    test: /how (should|can|do you want|would you like) (we|us to) (communicate|contact|reach)|preferred (method of )?(communication|contact)|best way to (reach|contact)/,
    answer: (field) => several('contactMethod', field, ['Email']),
  },

  // Where they heard about it.
  {
    key: 'referrer',
    test: /\breferr(er|ed by)|who referred|name of (the )?(person|employee) who|employee name|referral name|if (you were|so) .*\breferr/,
    answer: (field) => empty('referrer', field),
  },
  {
    key: 'referred',
    test: /were you referred|\breferred (to|for) this|did (someone|anyone) refer/,
    answer: (field) => yesNo('referred', field, false),
  },
  {
    key: 'howHeard',
    test: /how did you (first )?(hear|learn|find|come across)|where (did|have) you (first )?(hear|find|learn|see)|how you heard|source of (your )?(application|referral)|^source$|referral source|how were you referred|how did .* (find|reach) you|first learn about/,
    answer: (field, ctx) => {
      const preferred = ctx.profile.answers.howHeard;
      if (isTextKind(field.kind)) return text('howHeard', field, preferred[0] ?? '');
      const texts = preferred.flatMap((source) => HEARD_SYNONYMS[norm(source)] ?? [source]);
      if (company(ctx))
        texts.push(`${company(ctx)} website`, `${company(ctx)} careers`, `${company(ctx)} Career Site`);
      if (field.kind === 'multi') return several('howHeard', field, texts.slice(0, 1));
      return choose('howHeard', field, { kind: 'like', texts: [...texts, 'Other'] });
    },
  },

  // Timing and pay.
  {
    key: 'startDate',
    test: /start date|earliest\b.{0,30}\b(start|begin)|when (can|could|would) you (be available to )?(start|begin)|available to (start|begin)|availability to (start|begin)|notice period|how soon (can|could) you|when can you start|when (will|would) you be available/,
    // A fellowship's start date belongs to the veterans' programs some forms add.
    not: /fellowship/,
    answer: (field, ctx) => {
      const { answers } = ctx.profile;
      const iso = addDays(ctx.today, answers.startInWeeks * 7);
      const phrase =
        answers.earliestStart ||
        (answers.startInWeeks === 0 ? 'Immediately' : `${answers.startInWeeks} weeks`);
      const offered = firstDateFrom(field.options, iso, ctx.today);
      if (offered) return text('startDate', field, offered);
      if (isChoiceKind(field.kind))
        return choose('startDate', field, {
          kind: 'like',
          texts: [
            `${answers.startInWeeks} weeks`,
            answers.startInWeeks <= 2 ? '2 weeks' : '1 month',
            'Immediately',
          ],
        });
      return date('startDate', field, iso, phrase);
    },
  },
  // The date beside a signature, as on the disability self-identification form.
  {
    key: 'signatureDate',
    test: /^(today s )?date$|^date (signed|of signature)$|^signature date$/,
    kinds: ['text', 'date'],
    answer: (_field, ctx) => done('signatureDate', { type: 'date', iso: ctx.today }),
  },
  {
    key: 'salary',
    test: /salary|compensation|pay (expectation|range)|desired (pay|salary|compensation|base)|expected (pay|salary|compensation)|base pay|rate expectation/,
    answer: (field, ctx) =>
      text('salary', field, ctx.profile.answers.salary, [], {
        note: ctx.profile.answers.salary ? null : 'salary expectation',
      }),
  },
  {
    key: 'timeline',
    test: /deadline|timeline consideration|competing offer|other (offers|interviews|processes)|interviewing elsewhere|time sensitiv/,
    answer: (field, ctx) => {
      const timeline = ctx.profile.answers.timeline;
      if (isTextKind(field.kind)) return text('timeline', field, timeline || 'No');
      return yesNo('timeline', field, Boolean(timeline));
    },
  },
  {
    key: 'essentialFunctions',
    test: /perform (the |these |all )?(essential|core) (functions|duties)|meet (the )?attendance requirements/,
    answer: (field) => yesNo('essentialFunctions', field, true),
  },
  {
    key: 'accommodation',
    test: /accommodat|adjustments? (we can|to assist)|accessib/,
    answer: (field) =>
      isTextKind(field.kind) ? empty('accommodation', field) : yesNo('accommodation', field, false),
  },

  // Experience and education.
  {
    key: 'years',
    test: /years of (relevant |professional |industry |work |full ?time |post ?college |total |software |engineering )*(work )?experience|how many years (of )?(relevant |professional |industry |work |full ?time )*(experience|have you worked)|\d+\+? (or more )?years?\b.*\bexperience/,
    answer: (field, ctx) => {
      const years = yearsOfExperience(ctx.profile, ctx.today);
      const label = norm(field.label);
      const atLeast = /at least (\d+)|over (\d+)|(\d+)\+? (or more )?years/.exec(label);
      const threshold = atLeast ? Number(atLeast[1] ?? atLeast[2] ?? atLeast[3]) : null;
      const specific = SKILL_WORDS.test(label);
      const yesNoField =
        field.kind === 'radio' ||
        field.kind === 'checkbox' ||
        isTextKind(field.kind) ||
        (isChoiceKind(field.kind) && field.options.some((option) => /^(yes|no)\b/i.test(option.trim())));
      if (threshold !== null && yesNoField) {
        // Above the applicant's total years the answer is no whatever the skill; below it, a skill needs judgment.
        if (years < threshold) return yesNo('years', field, false);
        if (specific)
          return {
            status: field.required ? 'missing' : 'skipped',
            answer: null,
            key: 'unknown',
            note: null,
            critical: false,
          };
        return yesNo('years', field, true);
      }
      if (specific)
        return {
          status: field.required ? 'missing' : 'skipped',
          answer: null,
          key: 'unknown',
          note: null,
          critical: false,
        };
      if (isChoiceKind(field.kind)) return choose('years', field, { kind: 'range', value: years });
      return text('years', field, String(years));
    },
  },
  {
    key: 'student',
    test: /currently (enrolled|a student|attending)|are you a (current )?student/,
    not: /^(which|what)\b/,
    answer: (field, ctx) => {
      const school = latestEducation(ctx.profile);
      return yesNo(
        'student',
        field,
        Boolean(school && (school.end === null || school.end > ctx.today.slice(0, 7))),
      );
    },
  },
  {
    key: 'education.gpa',
    test: /\bgpa\b|grade point/,
    answer: (field, ctx) => {
      const school = /undergrad|bachelor/.test(norm(field.label))
        ? latestEducation(ctx.profile, 'bachelor')
        : latestEducation(ctx.profile);
      return text('education.gpa', field, school?.gpa ?? '');
    },
  },
  {
    key: 'education.graduation',
    test: /graduat(ion|e|ed|ing) (date|year|month)|(did|do|will) you graduate|year of graduation|expected graduation|graduation|anticipate graduating|complete your degree|year (did|will) you (complete|finish)|degree (completion|conferral)/,
    answer: (field, ctx) => {
      const end = latestEducation(ctx.profile)?.end ?? null;
      if (!end) return empty('education.graduation', field);
      const inTerms = graduatesInNamedTerms(field, end);
      if (inTerms !== null) return yesNo('education.graduation', field, inTerms);
      if (isChoiceKind(field.kind)) {
        // Years ("2025"), month lists ("June"), year ranges ("2023-2026"); a graduate picks "Other" among future terms.
        const texts = [end.slice(0, 4), month(end), month(end).split(' ')[0] ?? ''];
        const option = field.options.length
          ? (pickOption(field.options, { kind: 'like', texts }) ??
            pickRange(field.options, Number(end.slice(0, 4))))
          : null;
        if (option) return choose('education.graduation', field, { kind: 'like', texts: [option] });
        return choose('education.graduation', field, { kind: 'like', texts: [...texts, 'Other'] });
      }
      return date('education.graduation', field, `${end}-01`, month(end));
    },
  },
  {
    key: 'education.degree',
    test: /degree|level of education|highest (level of )?education|education level/,
    not: /years|experience|^do you have|^have you|^are you|\byear\b|\bwhen\b|\bmonth\b/,
    answer: (field, ctx) => {
      const school = latestEducation(ctx.profile);
      if (!school) return empty('education.degree', field);
      return text('education.degree', field, school.degree, DEGREE_NAMES[school.level]);
    },
  },
  {
    key: 'education.field',
    test: /\bmajor\b|field of study|discipline|area of study|concentration|program of study/,
    answer: (field, ctx) => text('education.field', field, latestEducation(ctx.profile)?.field ?? ''),
  },
  {
    key: 'education.school',
    test: /(which|what|name of (your|the)|your|last) (school|university|college|institution)|(school|university|college|institution)( name)?( attended)?$|university or school|attended|alma mater|^education/,
    not: /high school|schedule|currently enrolled/,
    answer: (field, ctx) =>
      text('education.school', field, latestEducation(ctx.profile)?.school ?? '', ['Other']),
  },
  {
    key: 'position',
    test: /\b(what|which) (\w+ ){0,2}(position|role|job|opening|requisition)s?( s)? (are you|you are) applying (for|to)\b|^(position|role|job( title)?) (you are )?appl(ying|ied) (for|to)$/,
    not: /\bother\b|location|office|city|country|team|how many|elsewhere|compan/,
    answer: (field, ctx) => text('position', field, ctx.posting?.title ?? ''),
  },
  {
    key: 'current.title',
    test: /current (or (most |more )?(recent|previous) )?(job )?(title|role|position)|most recent (job )?title|^(job )?title$|^position$|^current position/,
    answer: (field, ctx) => text('current.title', field, latestJob(ctx.profile)?.title ?? ''),
  },
  {
    key: 'current.company',
    test: /current (or (most |more )?(recent|previous) )?(company|employer|organi[sz]ation)|most recent (company|employer)|^company( name)?$|^employer( name)?$|^organi[sz]ation$|present employer/,
    answer: (field, ctx) => text('current.company', field, latestJob(ctx.profile)?.company ?? ''),
  },
  {
    key: 'workCountries',
    test: /countr(y|ies) you (anticipate|plan|intend|will be|expect) (to )?(working|work)|which countr(y|ies) (will|would) you work/,
    answer: (field, ctx) => ownCountry('workCountries', field, ctx),
  },
  // "Are you fluent in Arabic?": yes only for a language the profile lists.
  {
    key: 'languageFluency',
    test: new RegExp(
      `\\b(fluent|fluency|proficient|proficiency|speak|native|bilingual|conversational)\\b.*\\b(${LANGUAGE_NAMES.join('|')})\\b`,
    ),
    not: /what languages|which languages|languages do you speak|other languages/,
    kinds: ['text', 'select', 'radio', 'combobox'],
    answer: (field, ctx) => {
      const label = norm(field.label);
      const asked = LANGUAGE_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(label));
      const spoken = ctx.profile.languages.map(norm).join(' ');
      const speaks = (name: string) =>
        spoken.includes(name) || (name === 'chinese' && /mandarin|cantonese/.test(spoken));
      return yesNo('languageFluency', field, asked.every(speaks));
    },
  },
  {
    key: 'languages',
    test: /languages? (skills?|spoken|you speak|proficien)|what languages|languages do you speak|language skill/,
    answer: (field, ctx) => several('languages', field, ctx.profile.languages),
  },
];

/** The first rule for this field, if any. `label` is the field's label, normalized. */
export function findRule(field: ScannedField): Rule | null {
  const label = norm(field.label);
  return (
    RULES.find(
      (rule) =>
        (!rule.kinds || rule.kinds.includes(field.kind)) &&
        rule.test.test(label) &&
        !(rule.not && rule.not.test(label)),
    ) ?? null
  );
}
