import type { AuthFacts, AuthQuestion, FieldKind } from '../model';
import { authFacts, isUnitedStates } from '../profile/profile';
import type { Profile } from '../profile/schema';
import { leads, norm } from '../text';
import { cityAbroad, namesUnitedStates } from './geo';

/**
 * Work-authorization questions are answered by these rules alone, never by a model: a wrong answer here is the
 * costliest mistake an application can carry. Everything they answer is marked for the owner to confirm, and a
 * wording the rules can't read stays blank.
 */

export type AuthKind =
  | 'exportControl'
  | 'clearance'
  | 'sponsorship'
  | 'stemOpt'
  | 'opt'
  | 'citizen'
  | 'unrestricted'
  | 'status'
  | 'authorized';

const EXPORT_CONTROL =
  /\bexport control|\bsanction|\biran\b|\bcuba\b|north korea|\bsyria\b|\bcrimea\b|\bu ?s person\b|\bitar\b/;
const CLEARANCE = /\bclearance\b/;
const SPONSORSHIP =
  /\bsponsor|immigration (case|support|assistance)|visa (support|assistance)|assistance with (your )?work authori[sz]ation|\brequire (a |an )?(work )?(visa|permit)|work permit|right to work support/;
const STEM_OPT = /24 month|\bstem opt\b|\bstem extension\b/;
// "Opt in" and "opt out" are about messages, not Optional Practical Training.
const OPT = /\bopt\b(?! (in|out)\b)|optional practical training/;
const CITIZEN = /\bcitizen|\bpermanent resident|green card|\bnational (of|status)\b/;
const UNRESTRICTED = /unrestricted right|unlimited right/;
const STATUS =
  /visa (status|type)|immigration status|work (authori[sz]ation|permit) (status|type)|(type of|current) (work |visa |immigration )?(visa|authori[sz]ation)\b|residency status|citizenship status/;
const AUTHORIZED =
  /authori[sz]ed to work|\beligible to work|entitled to work|right to work|legal(ly)? (right|eligible|permitted|able)|work authori[sz]ation|legally work|authorised to work|work lawfully|lawfully work|legal right/;

export function classifyAuth(label: string, description = ''): AuthKind | null {
  const text = norm(`${label} ${description}`);
  const question = norm(label);
  // Grants and event sponsors aren't immigration sponsorship.
  if (/funding|\bgrants?\b|scholarship|event sponsor|corporate sponsor/.test(question)) return null;
  if (EXPORT_CONTROL.test(text)) return 'exportControl';
  if (CLEARANCE.test(question)) return 'clearance';
  if (SPONSORSHIP.test(question)) return 'sponsorship';
  if (STEM_OPT.test(question)) return 'stemOpt';
  if (OPT.test(question)) return 'opt';
  if (UNRESTRICTED.test(question)) return 'unrestricted';
  if (CITIZEN.test(question) && !AUTHORIZED.test(question)) return 'citizen';
  if (STATUS.test(question)) return 'status';
  if (AUTHORIZED.test(question)) return 'authorized';
  return null;
}

/** Countries a question may name. A question that names none is about the job's country. */
const COUNTRIES: Record<string, RegExp> = {
  'United States': /\b(united states( of america)?|u ?s ?a?|america)\b/,
  'United Kingdom': /\b(united kingdom|uk|u k|great britain|england)\b/,
  Canada: /\bcanada\b/,
  Poland: /\bpoland\b/,
  Germany: /\bgermany\b/,
  Ireland: /\bireland\b/,
  Netherlands: /\bnetherlands\b/,
  France: /\bfrance\b/,
  Spain: /\bspain\b/,
  Israel: /\bisrael\b/,
  India: /\bindia\b/,
  China: /\bchina\b/,
  'Hong Kong': /\bhong kong\b/,
  Singapore: /\bsingapore\b/,
  Japan: /\bjapan\b/,
  Korea: /\bkorea\b/,
  Australia: /\baustralia\b/,
  'New Zealand': /\bnew zealand\b/,
  Brazil: /\bbrazil\b/,
  Mexico: /\bmexico\b/,
  Serbia: /\bserbia\b/,
  Switzerland: /\bswitzerland\b/,
  'European Union': /\beuropean union\b|\beu\b/,
};

/** Countries the question names, in no particular order. */
export function namedCountries(label: string): string[] {
  const text = norm(label);
  return Object.entries(COUNTRIES)
    .filter(([, pattern]) => pattern.test(text))
    .map(([country]) => country);
}

/**
 * The country a question is about: the US when it names the US among others ("the U.S., Canada, and/or LATAM" is
 * answered for the US), otherwise the one non-US country it names.
 */
export function namedCountry(label: string): string | null {
  const named = namedCountries(label);
  return named.find((country) => isUnitedStates(country)) ?? named[0] ?? null;
}

/**
 * The country a posting's location is in: the US when it names any US place ("San Francisco; London" is
 * answered for San Francisco), otherwise the country or large city abroad it names. Null when it says neither.
 */
export function postingCountry(location: string | null): string | null {
  if (!location) return null;
  if (namesUnitedStates(location)) return 'United States';
  return namedCountries(location).find((country) => !isUnitedStates(country)) ?? cityAbroad(location);
}

type Scope = 'now' | 'future' | 'either';

function sponsorshipScope(question: string): Scope {
  const now = /\b(now|currently|current|presently|at this time|today)\b/.test(question);
  const future = /\bfuture\b|\bcontinue\b|\bextend\b|\bretain\b|\bmaintain\b|\brenew|\bafter\b|\bever\b/.test(
    question,
  );
  if (now && !future) return 'now';
  if (future && !now) return 'future';
  return 'either';
}

export interface AuthAnswer {
  question: AuthQuestion | null;
  /** For text fields. */
  text: string | null;
  note: string;
}

const EU = ['austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czechia', 'czech republic', 'denmark', 'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 'ireland', 'italy', 'latvia', 'lithuania', 'luxembourg', 'malta', 'netherlands', 'poland', 'portugal', 'romania', 'slovakia', 'slovenia', 'spain', 'sweden']; // prettier-ignore
const SANCTIONED = ['iran', 'cuba', 'north korea', 'syria', 'russia', 'belarus'];

/** Answers a work-authorization question from the profile. `jobCountry` defaults to the United States. */
export function answerAuth(
  kind: AuthKind,
  label: string,
  fieldKind: FieldKind,
  profile: Profile,
  options: readonly string[] = [],
  jobCountry = 'United States',
): AuthAnswer {
  const question = norm(label);
  const country = namedCountry(label) ?? jobCountry;
  const facts = authFacts(profile, country === 'European Union' ? 'Germany' : country);
  const auth = profile.workAuthorization;
  const citizenship = auth.citizenship.map(norm);
  // A text field asking "Will you…?" still wants a yes or no; only "What…"/"Which…" questions want prose.
  const isText =
    (fieldKind === 'text' || fieldKind === 'textarea') &&
    !/^(do|does|will|are|is|would|have|has|can|could|did)\b/.test(question);
  const ask = (answer: 'yes' | 'no' | null, note: string): AuthAnswer => ({
    question: { answer, facts },
    text: null,
    note,
  });
  const unknown = (note: string): AuthAnswer => ({ question: null, text: null, note });

  switch (kind) {
    case 'sponsorship': {
      const scope = sponsorshipScope(question);
      // Some forms list OPT among the things they call sponsorship; for them OPT itself is a yes.
      const optIsSponsorship = OPT.test(question) || STEM_OPT.test(question);
      if (isText) {
        return facts.sponsorshipNow || facts.sponsorshipFuture
          ? {
              question: null,
              text: auth.status ? `${auth.status}; H-1B sponsorship needed in the future` : '',
              note: 'status',
            }
          : { question: null, text: 'Not applicable', note: 'no sponsorship' };
      }
      if (scope === 'now') {
        if (facts.opt && optIsSponsorship)
          return ask('yes', 'sponsorship now: this form counts OPT as sponsorship');
        return ask(facts.sponsorshipNow ? 'yes' : 'no', 'sponsorship now only');
      }
      if (scope === 'future') return ask(facts.sponsorshipFuture ? 'yes' : 'no', 'sponsorship in the future');
      return ask(
        facts.sponsorshipNow || facts.sponsorshipFuture ? 'yes' : 'no',
        'sponsorship now or in the future',
      );
    }
    case 'authorized': {
      if (isText) return unknown('text answer about work authorization');
      // "Authorized to work for any employer" is narrower than authorized: OPT is tied to its employer, so someone on
      // it, or needing sponsorship, says no (the owner's call, 2026-09-30). Anyone else authorized without being a
      // citizen, a green card holder say, answers by hand: the profile doesn't tell them apart.
      if (/any employer|without (any )?restriction|unrestricted|full(y)? time without/.test(question)) {
        const onVisa = facts.opt || facts.sponsorshipNow || facts.sponsorshipFuture;
        return ask(
          facts.unrestricted ? 'yes' : !facts.authorized || onVisa ? 'no' : null,
          'authorized for any employer',
        );
      }
      return ask(facts.authorized ? 'yes' : 'no', `authorized to work in ${country}`);
    }
    case 'opt':
      return ask(facts.opt ? 'yes' : 'no', 'on OPT');
    case 'stemOpt':
      return ask(auth.opt === 'stem' ? 'yes' : 'no', 'STEM OPT extension');
    case 'citizen': {
      if (
        /\bu ?s\b|united states|american/.test(question) ||
        (!namedCountry(label) && /citizen|permanent resident|green card/.test(question))
      ) {
        const usCitizen = citizenship.some((name) => isUnitedStates(name));
        if (isText)
          return citizenship.length
            ? { question: null, text: auth.citizenship.join(', '), note: 'citizenship' }
            : unknown('citizenship not in the profile');
        return ask(usCitizen ? 'yes' : 'no', 'US citizen or permanent resident');
      }
      if (citizenship.length === 0) return unknown('citizenship not in the profile');
      if (/\beu\b|european union/.test(question))
        return ask(citizenship.some((name) => EU.includes(name)) ? 'yes' : 'no', 'EU citizen');
      const named = namedCountry(label);
      if (named) return ask(citizenship.includes(norm(named)) ? 'yes' : 'no', `citizen of ${named}`);
      return unknown('citizenship question');
    }
    case 'exportControl': {
      if (citizenship.length === 0) return unknown('export control: citizenship not in the profile');
      const sanctioned = citizenship.some((name) => SANCTIONED.includes(name));
      if (/additional citizenship|in which country did you obtain|first\b/.test(question))
        return unknown('export control follow-up');
      const listsNone = options.some((option) => /^none( of the above)?$/.test(norm(option)));
      if (
        listsNone ||
        /citizen|national|permanent resident|resident of|ordinarily/.test(question) ||
        /iran|cuba|north korea|syria/.test(question)
      ) {
        return ask(sanctioned ? 'yes' : 'no', 'export control: sanctioned-country citizen');
      }
      // "Are you any of the following?" over the U.S.-person categories, closed by "Other": someone on a visa
      // (needing sponsorship, or on OPT) is none of them. Citizens and residents are left to confirm by hand.
      const catchAll = options.find((option) => /^(other|neither|none of these)$/.test(norm(option)));
      const usPersonOptions = options.filter((option) =>
        /citizen|permanent resident|green ?card|protected individual|asylee|refugee/.test(norm(option)),
      );
      if (catchAll && usPersonOptions.length >= 2) {
        const onVisa =
          !facts.citizenOrResident && (facts.opt || facts.sponsorshipNow || facts.sponsorshipFuture);
        return onVisa
          ? { question: null, text: catchAll, note: 'export control: not a U.S. person' }
          : unknown('export control: U.S. person status');
      }
      return unknown('export control');
    }
    case 'clearance': {
      if (/eligible|able to obtain|obtain/.test(question)) {
        // A US clearance needs US citizenship.
        const usCitizen = citizenship.some((name) => isUnitedStates(name));
        return ask(usCitizen ? 'yes' : 'no', 'eligible for a security clearance');
      }
      return ask(profile.answers.securityClearance ? 'yes' : 'no', 'holds a security clearance');
    }
    case 'unrestricted': {
      if (isText) {
        return citizenship.length
          ? { question: null, text: auth.citizenship.join(', '), note: 'countries of citizenship' }
          : unknown('citizenship not in the profile');
      }
      return ask(facts.unrestricted ? 'yes' : 'no', 'unrestricted right to work');
    }
    case 'status':
      if (isText)
        return auth.status
          ? { question: null, text: auth.status, note: 'status' }
          : unknown('status not in the profile');
      return ask(null, 'work status');
  }
}

/** What an option says about the applicant, for the facts to agree or disagree with. */
interface Claims {
  authorized?: boolean;
  unrestricted?: boolean;
  citizenOrResident?: boolean;
  sponsorshipNow?: boolean;
  sponsorshipFuture?: boolean;
  opt?: boolean;
  /** Names the STEM extension of OPT, as against OPT itself. */
  stemOpt?: boolean;
  /** Names a visa other than F-1 OPT or H-1B. */
  otherVisa?: boolean;
  /** "Yes, but not one of the visas listed here". */
  unlisted?: boolean;
  unknown?: boolean;
}

function claimsOf(option: string): Claims {
  const text = norm(option);
  // Visas named as examples, "(e.g. H-1B, TN, etc.)", aren't the option's own claim.
  const bare = norm(option.replace(/\([^)]*\)/g, ' '));
  const claims: Claims = {};
  if (/\bunknown\b|\bnot sure\b|\bunsure\b/.test(text)) claims.unknown = true;
  // "F-1 (CPT)" is the F-1 of a student still enrolled, not OPT: for someone on OPT it's another visa.
  const cpt = /\bcpt\b|curricular practical/.test(text) && !/\bopt\b|optional practical/.test(text);
  if (cpt) claims.otherVisa = true;
  else if (/\bf ?1\b|\bopt\b|optional practical training/.test(text)) claims.opt = true;
  if (claims.opt && /\bstem\b|24 month/.test(text)) claims.stemOpt = true;
  if (
    /highly skilled|blue card|\btn\b|\be 3\b|\bo 1\b|\bl 1\b|dependent visa|iang|working holiday/.test(bare)
  ) {
    claims.otherVisa = true;
  }
  if (/not (one of )?(the visas )?listed|not listed here|none of the visas/.test(bare))
    claims.unlisted = true;

  const notAuthorized =
    /\bnot (currently )?(legally )?(authori[sz]ed|eligible)|\bno i am not\b|do not (currently )?have (an |the )?(legal )?right to work/.test(
      text,
    );
  if (notAuthorized) claims.authorized = false;
  else if (
    /\b(i am|i m)( currently)?( legally)? (authori[sz]ed|eligible)|\bauthori[sz]ed to work\b|valid visa with permission|no restriction|\bi can work\b/.test(
      text,
    )
  ) {
    claims.authorized = true;
  }

  if (/do not (currently )?have (an |the )?unlimited|not (have )?(an )?unrestricted/.test(text))
    claims.unrestricted = false;
  else if (/any employer|no restriction|unrestricted|unlimited right|without sponsorship/.test(text))
    claims.unrestricted = true;

  if (
    /\b(i am|i m) (a |an )?(\w+ )?citizen\b|citizen or permanent resident|\bpermanent resident\b|green card|\bcitizen of\b/.test(
      text,
    ) &&
    !/\bnot a\b/.test(text)
  ) {
    claims.citizenOrResident = true;
  }

  const never =
    /do not and will not|will not require|won t require|not require|do not require|don t require|without sponsorship|no restriction|do not need/.test(
      text,
    );
  if (never) {
    claims.sponsorshipNow = false;
    claims.sponsorshipFuture = false;
  } else if (/\b(require|need|requires|needs)\b|\bsponsor/.test(text)) {
    // Time words count only next to the verb: in "I do not currently have an unlimited right … and would need
    // sponsorship", "currently" is about the right, not the sponsorship.
    const at = text.search(/\b(require|need|requires|needs)\b|\bsponsor/);
    const clause = text.slice(Math.max(0, at - 25), at + 70);
    const now = /\bnow\b|currently|to obtain|at this time/.test(clause);
    // "Will require … now" is about now; only the future, a renewal or "require/will require" reach ahead.
    const future = /\bfuture\b|\blater\b|renewal|\bextend|require will require/.test(clause);
    if (now && future)
      claims.sponsorshipFuture = true; // "now or in the future": true for either
    else if (future) claims.sponsorshipFuture = true;
    else if (now) claims.sponsorshipNow = true;
    else claims.sponsorshipFuture = true;
  }
  return claims;
}

/** How well an option agrees with the facts: null if it contradicts them, otherwise the number of agreements. */
function agreement(claims: Claims, facts: AuthFacts): number | null {
  if (claims.unknown) return null;
  if (claims.otherVisa && !claims.opt) return null;
  if (claims.unlisted) return null;
  let score = 0;
  const check = (claim: boolean | undefined, fact: boolean) => {
    if (claim === undefined) return true;
    if (claim !== fact) return false;
    score++;
    return true;
  };
  if (!check(claims.authorized, facts.authorized)) return null;
  if (!check(claims.unrestricted, facts.unrestricted)) return null;
  if (claims.citizenOrResident) {
    if (!facts.citizenOrResident) return null;
    score += 2;
  }
  if (claims.sponsorshipNow === true && !facts.sponsorshipNow) return null;
  if (claims.sponsorshipNow === false && facts.sponsorshipNow) return null;
  if (claims.sponsorshipFuture === true && !(facts.sponsorshipFuture || facts.sponsorshipNow)) return null;
  if (claims.sponsorshipFuture === false && (facts.sponsorshipFuture || facts.sponsorshipNow)) return null;
  if (claims.sponsorshipNow !== undefined || claims.sponsorshipFuture !== undefined) score++;
  if (claims.opt) {
    if (!facts.opt) return null;
    score += 2;
  }
  // Where a list offers both, "STEM OPT" is the one for someone on the extension, and "OPT" for someone who isn't;
  // "OPT" alone still does for either.
  if (claims.stemOpt) {
    if (!facts.stemOpt) return null;
    score++;
  }
  return score;
}

/**
 * Picks the option that answers a work-authorization question, or null when the options don't settle it.
 *
 * First by the question's own answer: with a single "Yes…" option, a yes picks it. Only when several options
 * share that answer ("Yes, now" / "Yes, in the future"), or none starts with yes or no, do the options' own
 * claims decide.
 */
export function pickAuthOption(options: readonly string[], question: AuthQuestion): string | null {
  if (options.length === 0) return null;
  const { answer, facts } = question;
  const candidates = answer ? options.filter((option) => leads(option, answer)) : [];
  if (answer && candidates.length === 1) return candidates[0] ?? null;

  const pool =
    candidates.length > 1
      ? candidates
      : options.filter((option) => !leads(option, 'yes') && !leads(option, 'no'));
  const picked = bestByClaims(pool.length > 0 ? pool : options, facts);
  if (picked) return picked;
  // Export-control lists end in "None of the above" rather than "No".
  if (answer === 'no' && candidates.length === 0) {
    return (
      options.find((option) =>
        /^(none( of the above)?|none apply|does not apply|not applicable|n a)$/.test(norm(option)),
      ) ?? null
    );
  }
  return null;
}

/** The one option whose claims agree with the facts most; null on a tie or when none claims anything. */
function bestByClaims(options: readonly string[], facts: AuthFacts): string | null {
  const scored = options
    .map((option) => ({ option, score: agreement(claimsOf(option), facts) }))
    .filter((entry): entry is { option: string; score: number } => entry.score !== null && entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || (second && second.score === best.score)) return null;
  return best.option;
}
