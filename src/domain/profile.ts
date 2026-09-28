import { z } from 'zod';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const month = z.string().regex(MONTH, 'Expected YYYY-MM');
const text = z.string().trim().default('');

export const EEO_GENDERS = ['male', 'female', 'nonbinary', 'decline'] as const;
export const EEO_RACES = [
  'asian',
  'black',
  'white',
  'native-american',
  'pacific-islander',
  'two-or-more',
  'decline',
] as const;
export const EEO_YES_NO = ['yes', 'no', 'decline'] as const;
export const EEO_VETERAN = ['not', 'protected', 'decline'] as const;
export const EDUCATION_LEVELS = [
  'high-school',
  'associate',
  'bachelor',
  'master',
  'doctorate',
  'other',
] as const;
export const JOB_TYPES = ['full-time', 'part-time', 'internship', 'contract'] as const;

export const educationSchema = z.object({
  school: z.string().trim().min(1),
  degree: text,
  level: z.enum(EDUCATION_LEVELS).default('other'),
  field: text,
  start: month.nullable().default(null),
  end: month.nullable().default(null),
  gpa: text,
  location: text,
});

export const experienceSchema = z.object({
  company: z.string().trim().min(1),
  title: text,
  location: text,
  start: month,
  /** Null while the job is current. */
  end: month.nullable().default(null),
  type: z.enum(JOB_TYPES).default('full-time'),
  description: text,
});

/**
 * Everything the autofill extension fills applications from. The owner edits it on Outbox's profile page; it is
 * stored with their account and the extension syncs it before filling.
 */
export const profileSchema = z.object({
  version: z.literal(1),
  name: z.object({
    first: z.string().trim().min(1),
    last: z.string().trim().min(1),
    /** What they go by, if not the legal first name. */
    preferred: text,
    /** Empty means "prefer not to say". */
    pronouns: text,
    pronunciation: text,
  }),
  phone: text,
  address: z
    .object({
      line1: text,
      city: text,
      state: text,
      zip: text,
      country: z.string().trim().default('United States'),
    })
    .default({ line1: '', city: '', state: '', zip: '', country: 'United States' }),
  links: z
    .object({ linkedin: text, github: text, website: text, twitter: text })
    .default({ linkedin: '', github: '', website: '', twitter: '' }),
  workAuthorization: z.object({
    /** Countries they may work in today. Citizenship countries count too; no need to repeat them. */
    authorizedCountries: z.array(z.string().trim()).default(['United States']),
    /** Needs an employer to sponsor them to work now. */
    sponsorshipNow: z.boolean(),
    /** Will need sponsorship later, e.g. H-1B after OPT. */
    sponsorshipFuture: z.boolean(),
    /** As written on forms that ask, e.g. "F-1 STEM OPT". */
    status: text,
    opt: z.enum(['none', 'opt', 'stem']).default('none'),
    /** Countries of citizenship. Only export-control and right-to-work questions use it. */
    citizenship: z.array(z.string().trim()).default([]),
  }),
  education: z.array(educationSchema).default([]),
  experience: z.array(experienceSchema).default([]),
  skills: z.array(z.string().trim()).default([]),
  languages: z.array(z.string().trim()).default(['English']),
  eeo: z
    .object({
      gender: z.enum(EEO_GENDERS).default('decline'),
      hispanic: z.enum(EEO_YES_NO).default('decline'),
      race: z.enum(EEO_RACES).default('decline'),
      veteran: z.enum(EEO_VETERAN).default('decline'),
      disability: z.enum(EEO_YES_NO).default('decline'),
    })
    .default({
      gender: 'decline',
      hispanic: 'decline',
      race: 'decline',
      veteran: 'decline',
      disability: 'decline',
    }),
  answers: z
    .object({
      /** Tried in order against a form's options: "LinkedIn", then "Company website". */
      howHeard: z.array(z.string().trim()).default(['LinkedIn', 'Company website']),
      /** For text fields, e.g. "Two weeks after an offer". */
      earliestStart: text,
      /** For date fields: today plus this many weeks. */
      startInWeeks: z.number().int().min(0).max(52).default(2),
      /** Empty leaves salary questions for the owner. */
      salary: text,
      /** Null works it out from full-time experience. */
      yearsOfExperience: z.number().min(0).max(60).nullable().default(null),
      relocate: z.boolean().default(true),
      onsite: z.boolean().default(true),
      over18: z.boolean().default(true),
      nonCompete: z.boolean().default(false),
      governmentOfficial: z.boolean().default(false),
      relativeOfGovernmentOfficial: z.boolean().default(false),
      securityClearance: z.boolean().default(false),
      contactCurrentEmployer: z.boolean().default(false),
      emailOptIn: z.boolean().default(true),
      smsOptIn: z.boolean().default(false),
      /** Companies interviewed with before; "have you interviewed here before?" checks it. */
      interviewedAt: z.array(z.string().trim()).default([]),
      /** Deadlines or other offers; empty answers "No". */
      timeline: text,
    })
    .prefault({}),
  /** Material free-text drafts are built from; never invented. */
  writing: z
    .object({
      summary: text,
      stories: z.array(z.object({ title: z.string().trim(), text: z.string().trim() })).default([]),
      snippets: z.array(z.string().trim()).default([]),
    })
    .prefault({}),
});

export type Profile = z.output<typeof profileSchema>;
export type ProfileInput = z.input<typeof profileSchema>;
export type Education = z.output<typeof educationSchema>;
export type Experience = z.output<typeof experienceSchema>;

export type ParsedProfile = { ok: true; profile: Profile } | { ok: false; errors: string[] };

export function parseProfile(json: unknown): ParsedProfile {
  const result = profileSchema.safeParse(json);
  if (result.success) return { ok: true, profile: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  };
}

/** A profile as stored: what was saved and when. */
export interface SavedProfile {
  profile: Profile;
  updatedAt: string;
}

/** A blank profile to start editing from. Not valid until the name is filled in. */
export function emptyProfile(): Profile {
  return {
    version: 1,
    name: { first: '', last: '', preferred: '', pronouns: '', pronunciation: '' },
    phone: '',
    address: { line1: '', city: '', state: '', zip: '', country: 'United States' },
    links: { linkedin: '', github: '', website: '', twitter: '' },
    workAuthorization: {
      authorizedCountries: ['United States'],
      sponsorshipNow: false,
      sponsorshipFuture: false,
      status: '',
      opt: 'none',
      citizenship: [],
    },
    education: [],
    experience: [],
    skills: [],
    languages: ['English'],
    eeo: {
      gender: 'decline',
      hispanic: 'decline',
      race: 'decline',
      veteran: 'decline',
      disability: 'decline',
    },
    answers: profileSchema.shape.answers.parse({}),
    writing: { summary: '', stories: [], snippets: [] },
  };
}

export type MissingItem =
  | 'phone'
  | 'address.city'
  | 'address.zip'
  | 'links.linkedin'
  | 'workAuthorization.citizenship'
  | 'answers.salary'
  | 'answers.earliestStart'
  | 'education'
  | 'experience';

/** Blanks worth filling before the first application. */
export function missingItems(profile: Profile): MissingItem[] {
  const missing: MissingItem[] = [];
  if (!profile.phone) missing.push('phone');
  if (!profile.address.city) missing.push('address.city');
  if (!profile.address.zip) missing.push('address.zip');
  if (!profile.links.linkedin) missing.push('links.linkedin');
  if (profile.workAuthorization.citizenship.length === 0) missing.push('workAuthorization.citizenship');
  if (!profile.answers.salary) missing.push('answers.salary');
  if (!profile.answers.earliestStart) missing.push('answers.earliestStart');
  if (profile.education.length === 0) missing.push('education');
  if (profile.experience.length === 0) missing.push('experience');
  return missing;
}

/**
 * What a resume settles, as the extension's model reads it from the PDF. Dates are YYYY-MM or empty; what a resume
 * never says (work authorization, EEO, preferences) isn't here.
 */
export const resumeFactsSchema = z.object({
  name: z.object({ first: text, last: text, preferred: text }).prefault({}),
  phone: text,
  location: z.object({ city: text, state: text, country: text }).prefault({}),
  links: z.object({ linkedin: text, github: text, website: text }).prefault({}),
  education: z
    .array(
      z.object({
        school: text,
        degree: text,
        level: z.enum(EDUCATION_LEVELS).catch('other'),
        field: text,
        start: text,
        end: text,
        gpa: text,
        location: text,
      }),
    )
    .default([]),
  experience: z
    .array(
      z.object({
        company: text,
        title: text,
        location: text,
        start: text,
        /** Empty for a current job. */
        end: text,
        type: z.enum(JOB_TYPES).catch('full-time'),
        description: text,
      }),
    )
    .default([]),
  skills: z.array(z.string().trim()).default([]),
  languages: z.array(z.string().trim()).default([]),
  summary: text,
});

export type ResumeFacts = z.output<typeof resumeFactsSchema>;

/** Which parts of a read resume go into the profile. */
export interface ResumeParts {
  contact: boolean;
  education: boolean;
  experience: boolean;
  skills: boolean;
  summary: boolean;
}

export type ContactField =
  'first' | 'last' | 'preferred' | 'phone' | 'city' | 'state' | 'linkedin' | 'github' | 'website';

/** The contact details and links a resume fills: only those the profile leaves empty. */
export function resumeContact(
  profile: Profile,
  facts: ResumeFacts,
): { field: ContactField; value: string }[] {
  const pairs: [ContactField, string, string][] = [
    ['first', profile.name.first, facts.name.first],
    ['last', profile.name.last, facts.name.last],
    ['preferred', profile.name.preferred, facts.name.preferred],
    ['phone', profile.phone, facts.phone],
    ['city', profile.address.city, facts.location.city],
    ['state', profile.address.state, facts.location.state],
    ['linkedin', profile.links.linkedin, facts.links.linkedin],
    ['github', profile.links.github, facts.links.github],
    ['website', profile.links.website, facts.links.website],
  ];
  return pairs
    .filter(([, current, found]) => !current.trim() && found.trim())
    .map(([field, , value]) => ({ field, value: value.trim() }));
}

/** Words a list doesn't have yet, ignoring case: new skills or languages from a resume. */
export function resumeAdditions(current: readonly string[], found: readonly string[]): string[] {
  const seen = new Set(current.map((item) => item.trim().toLowerCase()));
  return found.filter((item) => {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const monthOrNull = (value: string) => (MONTH.test(value) ? value : null);

/**
 * Puts a read resume into a profile. Contact details and links fill only empty fields; education and work experience
 * are replaced by the resume's; skills and languages gain what's new; the summary fills an empty one. A job whose
 * start the resume doesn't date keeps it empty, so saving asks for it.
 */
export function applyResume(profile: Profile, facts: ResumeFacts, parts: ResumeParts): Profile {
  let next = profile;
  if (parts.contact) {
    const fill: Partial<Record<ContactField, string>> = Object.fromEntries(
      resumeContact(profile, facts).map(({ field, value }) => [field, value]),
    );
    next = {
      ...next,
      name: {
        ...next.name,
        first: fill.first ?? next.name.first,
        last: fill.last ?? next.name.last,
        preferred: fill.preferred ?? next.name.preferred,
      },
      phone: fill.phone ?? next.phone,
      address: {
        ...next.address,
        city: fill.city ?? next.address.city,
        state: fill.state ?? next.address.state,
      },
      links: {
        ...next.links,
        linkedin: fill.linkedin ?? next.links.linkedin,
        github: fill.github ?? next.links.github,
        website: fill.website ?? next.links.website,
      },
    };
  }
  const schools = facts.education.filter((school) => school.school);
  if (parts.education && schools.length) {
    next = {
      ...next,
      education: schools.map((school) => ({
        ...school,
        start: monthOrNull(school.start),
        end: monthOrNull(school.end),
      })),
    };
  }
  const jobs = facts.experience.filter((job) => job.company);
  if (parts.experience && jobs.length) {
    next = {
      ...next,
      experience: jobs.map((job) => ({
        ...job,
        start: monthOrNull(job.start) ?? '',
        end: monthOrNull(job.end),
      })),
    };
  }
  if (parts.skills) {
    next = {
      ...next,
      skills: [...next.skills, ...resumeAdditions(next.skills, facts.skills)],
      languages: [...next.languages, ...resumeAdditions(next.languages, facts.languages)],
    };
  }
  if (parts.summary && !next.writing.summary.trim() && facts.summary) {
    next = { ...next, writing: { ...next.writing, summary: facts.summary } };
  }
  return next;
}
