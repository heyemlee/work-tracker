import type { MissingItem } from '../domain/profile';

/** The profile's sections, in the order the panel shows them. */
export const PROFILE_SECTIONS = [
  'basics',
  'address',
  'links',
  'auth',
  'education',
  'experience',
  'skills',
  'eeo',
  'answers',
  'writing',
] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** The section where each blank on the checklist is filled in. */
export const SECTION_OF_MISSING: Record<MissingItem, ProfileSection> = {
  phone: 'basics',
  'address.city': 'address',
  'address.zip': 'address',
  'links.linkedin': 'links',
  'workAuthorization.citizenship': 'auth',
  'answers.salary': 'answers',
  'answers.earliestStart': 'answers',
  education: 'education',
  experience: 'experience',
};
