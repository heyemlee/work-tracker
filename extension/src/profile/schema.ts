import { z } from 'zod';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
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

export const educationSchema = z.object({
  school: z.string().trim().min(1),
  degree: text,
  level: z.enum(['high-school', 'associate', 'bachelor', 'master', 'doctorate', 'other']).default('other'),
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
  type: z.enum(['full-time', 'part-time', 'internship', 'contract']).default('full-time'),
  description: text,
});

/**
 * Everything the extension fills from. The owner keeps it in `~/Desktop/job-search/autofill-profile.json` and
 * imports it on the options page; it never leaves the machine except as answers typed into forms.
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
