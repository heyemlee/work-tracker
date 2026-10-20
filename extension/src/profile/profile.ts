import { normalizeCompanyName } from '@domain/companies';
import type { AuthFacts } from '../model';
import { norm } from '../text';
import type { Education, Experience, Profile } from './schema';

export function fullName(profile: Profile): string {
  return `${profile.name.first} ${profile.name.last}`;
}

export function preferredFirst(profile: Profile): string {
  return profile.name.preferred || profile.name.first;
}

export function preferredFull(profile: Profile): string {
  return `${preferredFirst(profile)} ${profile.name.last}`;
}

/** The job without an end date; the latest one if there are several. */
export function currentJob(profile: Profile): Experience | null {
  const current = profile.experience.filter((job) => job.end === null);
  return [...current].sort((a, b) => b.start.localeCompare(a.start))[0] ?? null;
}

/** The current job, or else the one that ended last. */
export function latestJob(profile: Profile): Experience | null {
  return (
    currentJob(profile) ??
    [...profile.experience].sort((a, b) => (b.end ?? '').localeCompare(a.end ?? ''))[0] ??
    null
  );
}

/** The highest degree, latest first among equals. */
export function latestEducation(profile: Profile, level?: Education['level']): Education | null {
  const rank: Record<Education['level'], number> = {
    'high-school': 0,
    associate: 1,
    other: 1,
    bachelor: 2,
    master: 3,
    doctorate: 4,
  };
  const pool = level ? profile.education.filter((school) => school.level === level) : profile.education;
  return (
    [...pool].sort((a, b) => rank[b.level] - rank[a.level] || (b.end ?? '').localeCompare(a.end ?? ''))[0] ??
    null
  );
}

const monthsBetween = (start: string, end: string) => {
  const [startYear = 0, startMonth = 1] = start.split('-').map(Number);
  const [endYear = 0, endMonth = 1] = end.split('-').map(Number);
  return Math.max(0, (endYear - startYear) * 12 + (endMonth - startMonth));
};

/** Years of full-time work, rounded down, unless the profile says otherwise. `today` is YYYY-MM-DD. */
export function yearsOfExperience(profile: Profile, today: string): number {
  if (profile.answers.yearsOfExperience !== null) return profile.answers.yearsOfExperience;
  const now = today.slice(0, 7);
  const months = profile.experience
    .filter((job) => job.type === 'full-time' || job.type === 'contract')
    .reduce((sum, job) => sum + monthsBetween(job.start, job.end ?? now), 0);
  return Math.floor(months / 12);
}

/** Whether they have worked at this company, by normalized name. */
export function workedAt(profile: Profile, company: string): boolean {
  const target = normalizeCompanyName(company);
  return target !== '' && profile.experience.some((job) => normalizeCompanyName(job.company) === target);
}

export function interviewedAt(profile: Profile, company: string): boolean {
  const target = normalizeCompanyName(company);
  return target !== '' && profile.answers.interviewedAt.some((name) => normalizeCompanyName(name) === target);
}

/**
 * The phone number without its country code, for a form that asks for the code apart: "+1 408-555-0100" is
 * "408-555-0100". A number written without a code stays as it is.
 */
export function nationalPhone(phone: string): string {
  const number = phone.trim();
  const spaced = /^\+\d{1,3}[\s.-]+(\S.*)$/.exec(number);
  if (spaced) return spaced[1] ?? number;
  // Written as one run of digits: a North American number is the code 1 and ten digits.
  const digits = number.replace(/[\s().-]/g, '');
  const american = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(digits);
  return american ? american.slice(1).join('-') : number;
}

/** "Santa Clara, CA". */
export function cityState(profile: Profile): string {
  return [profile.address.city, profile.address.state].filter(Boolean).join(', ');
}

export const US_NAMES = ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a', 'america'];

export const isUnitedStates = (country: string) => US_NAMES.includes(norm(country));

function sameCountry(a: string, b: string): boolean {
  if (isUnitedStates(a) && isUnitedStates(b)) return true;
  return norm(a) === norm(b);
}

/** What decides work-authorization answers for a job in `country`. */
export function authFacts(profile: Profile, country: string): AuthFacts {
  const auth = profile.workAuthorization;
  const citizen = auth.citizenship.some((name) => sameCountry(name, country));
  const authorized = citizen || auth.authorizedCountries.some((name) => sameCountry(name, country));
  const home = isUnitedStates(country);
  return {
    authorized,
    // Only citizens (or, elsewhere, residents) are free of employer restrictions; OPT is tied to E-Verify
    // employers and the degree's field.
    unrestricted: citizen || (authorized && !home && !auth.sponsorshipFuture),
    citizenOrResident: citizen,
    sponsorshipNow: !authorized || (home ? auth.sponsorshipNow : false),
    sponsorshipFuture: !citizen && (!authorized || (home ? auth.sponsorshipFuture : false)),
    opt: home && auth.opt !== 'none',
    stemOpt: home && auth.opt === 'stem',
  };
}

export { missingItems } from './schema';
