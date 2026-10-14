import type { ProfileIssue } from '../../messages';
import type { Profile } from '../../profile/schema';
import { US_STATES } from '../../rules/geo';
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

/** The pronouns forms offer, in the short form the profile keeps: "He/him" also finds "He/him/his". */
export const PRONOUNS = ['He/him', 'She/her', 'They/them'];

/**
 * Work statuses as forms word them, and what each says about OPT: picking one sets both, so the two can't disagree
 * (an "H-1B" still counted as on OPT would answer OPT questions with a yes).
 */
export const STATUSES: { value: string; opt: Profile['workAuthorization']['opt'] }[] = [
  { value: 'U.S. Citizen', opt: 'none' },
  { value: 'Permanent Resident', opt: 'none' },
  { value: 'F-1 OPT', opt: 'opt' },
  { value: 'F-1 STEM OPT', opt: 'stem' },
  { value: 'F-1 CPT', opt: 'none' },
  { value: 'H-1B', opt: 'none' },
  { value: 'H-4 EAD', opt: 'none' },
  { value: 'L-2 EAD', opt: 'none' },
  { value: 'O-1', opt: 'none' },
  { value: 'TN', opt: 'none' },
  { value: 'J-1', opt: 'none' },
];

/**
 * Languages forms ask about, the commonest first, by the names the fill rules know. "Mandarin" and "Cantonese" each
 * answer for "Chinese" too.
 */
// prettier-ignore
export const LANGUAGES = [
  'English', 'Mandarin', 'Cantonese', 'Spanish', 'Korean', 'Japanese', 'French', 'German', 'Hindi', 'Portuguese',
  'Arabic', 'Russian', 'Italian', 'Vietnamese', 'Indonesian', 'Thai', 'Turkish', 'Dutch', 'Polish', 'Ukrainian',
  'Hebrew', 'Persian', 'Urdu', 'Bengali', 'Punjabi', 'Tamil', 'Telugu', 'Tagalog', 'Malay', 'Swedish', 'Norwegian',
  'Danish', 'Finnish', 'Greek', 'Czech', 'Romanian', 'Hungarian',
];

/** US states by name, kept by their two-letter code as forms and the fill rules take either. */
export const STATES = Object.entries(US_STATES).map(([value, name]) => ({
  value,
  label: `${name} (${value})`,
}));

/**
 * A dropdown over a field the profile keeps as text: `none` for leaving it empty, the usual values, and whatever
 * else the profile already holds (typed on Outbox), so opening the window never changes it.
 */
export function picks(
  values: readonly (string | { value: string; label: string })[],
  current: string,
  none: string,
): { value: string; label: string }[] {
  const options = values.map((item) => (typeof item === 'string' ? { value: item, label: item } : item));
  const held = current && !options.some((option) => option.value === current);
  return [{ value: '', label: none }, ...options, ...(held ? [{ value: current, label: current }] : [])];
}

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
    education: profile.education.filter(heldSchool),
    experience: profile.experience.filter(heldJob),
    writing: {
      ...profile.writing,
      stories: profile.writing.stories.filter(heldStory),
      snippets: profile.writing.snippets.filter((snippet) => !empty(snippet)),
    },
  };
}

const heldSchool = (school: Profile['education'][number]) =>
  !empty(school.school, school.degree, school.field, school.gpa, school.location, school.start, school.end);
const heldJob = (job: Profile['experience'][number]) =>
  !empty(job.company, job.title, job.location, job.start, job.end, job.description);
const heldStory = (story: Profile['writing']['stories'][number]) => !empty(story.title, story.text);

/**
 * A path into the tidied profile (what was checked) as a path into the draft (what the window shows): an entry's
 * number counts the blank ones the window still shows above it. "Work experience 2" is the second the owner sees.
 */
export function inDraft(draft: Profile, path: readonly string[]): string[] {
  const [part, second, third, ...rest] = path;
  // The draft's places of the entries the tidied list kept, in order.
  const places = <T>(list: readonly T[], held: (item: T) => boolean) =>
    list.flatMap((item, at) => (held(item) ? [at] : []));
  const at = (kept: number[], index: string | undefined) => String(kept[Number(index)] ?? index);
  if (part === 'education') return [part, at(places(draft.education, heldSchool), second), ...path.slice(2)];
  if (part === 'experience') return [part, at(places(draft.experience, heldJob), second), ...path.slice(2)];
  if (part === 'writing' && second === 'stories')
    return [part, second, at(places(draft.writing.stories, heldStory), third), ...rest];
  return [...path];
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
