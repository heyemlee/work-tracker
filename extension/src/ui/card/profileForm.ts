import type { ProfileIssue } from '../../messages';
import type { Profile } from '../../profile/schema';
import type { MessageKey, Translate } from '../i18n';

/** The profile window's sections, in the order its list shows them. */
export const SECTIONS = [
  'personal',
  'auth',
  'education',
  'experience',
  'skills',
  'eeo',
  'answers',
  'writing',
] as const;

export type Section = (typeof SECTIONS)[number];

/** The yes-or-no answers under "Common questions", in the order forms tend to ask them. */
export const ANSWER_SWITCHES = [
  'relocate',
  'onsite',
  'over18',
  'nonCompete',
  'governmentOfficial',
  'relativeOfGovernmentOfficial',
  'securityClearance',
  'contactCurrentEmployer',
  'emailOptIn',
  'smsOptIn',
] as const;

const empty = (...values: (string | null)[]) => values.every((value) => !value?.trim());

/**
 * The draft as it should be saved: entries added and left blank go, so a stray "Add school" doesn't hold up the
 * save; an entry with anything in it stays, and is checked.
 */
export function tidy(profile: Profile): Profile {
  return {
    ...profile,
    education: profile.education.filter(
      (school) =>
        !empty(
          school.school,
          school.degree,
          school.field,
          school.gpa,
          school.location,
          school.start,
          school.end,
        ),
    ),
    experience: profile.experience.filter(
      (job) => !empty(job.company, job.title, job.location, job.start, job.end, job.description),
    ),
    writing: {
      ...profile.writing,
      stories: profile.writing.stories.filter((story) => !empty(story.title, story.text)),
      snippets: profile.writing.snippets.filter((snippet) => !empty(snippet)),
    },
  };
}

const SECTION_OF: Record<string, Section> = {
  name: 'personal',
  phone: 'personal',
  address: 'personal',
  links: 'personal',
  workAuthorization: 'auth',
  education: 'education',
  experience: 'experience',
  skills: 'skills',
  languages: 'skills',
  eeo: 'eeo',
  answers: 'answers',
  writing: 'writing',
};

/** Fields whose name in the profile isn't the name of their label. */
const LABEL_OF: Record<string, MessageKey> = {
  title: 'profile.f.jobTitle',
  text: 'profile.f.storyText',
};

/**
 * Where a profile doesn't hold, in the owner's words, and the section to go to for it: "Legal first name is
 * required", "Work experience 2 · Start isn't valid".
 */
export function describeIssue(issue: ProfileIssue, t: Translate): { section: Section; text: string } {
  const [part, second, third, fourth] = issue.path.map(String);
  const section = SECTION_OF[part ?? ''] ?? 'personal';
  const label = (key: string | undefined) => t(LABEL_OF[key ?? ''] ?? (`profile.f.${key}` as MessageKey));
  let field: string;
  if ((part === 'education' || part === 'experience') && third !== undefined)
    field = `${t(`profile.s.${part}`)} ${Number(second) + 1} · ${label(third)}`;
  else if (part === 'writing' && second === 'stories' && fourth !== undefined)
    field = `${t('profile.f.stories')} ${Number(third) + 1} · ${label(fourth)}`;
  else field = label(second ?? part);
  return {
    section,
    text: t(issue.code === 'too_small' ? 'profile.required' : 'profile.badValue', { field }),
  };
}
