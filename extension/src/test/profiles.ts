import { parseProfile, type Profile, type ProfileInput } from '../profile/schema';

/** A made-up applicant on F-1 STEM OPT: authorized now, needs H-1B sponsorship later. Not the owner's data. */
export const OPT_APPLICANT: ProfileInput = {
  version: 1,
  name: { first: 'Alex', last: 'Chen', preferred: 'Al' },
  phone: '+1 408-555-0100',
  address: { city: 'Santa Clara', state: 'CA', zip: '95050', country: 'United States' },
  links: { linkedin: 'https://www.linkedin.com/in/alex-chen', github: 'https://github.com/alexchen' },
  workAuthorization: {
    authorizedCountries: ['United States'],
    sponsorshipNow: false,
    sponsorshipFuture: true,
    status: 'F-1 STEM OPT',
    opt: 'stem',
    citizenship: ['China'],
  },
  education: [
    {
      school: 'Santa Clara University',
      degree: 'Master of Science',
      level: 'master',
      field: 'Computer Science',
      start: '2023-09',
      end: '2025-06',
    },
    {
      school: 'Example University',
      degree: 'Bachelor of Engineering',
      level: 'bachelor',
      field: 'Software Engineering',
      start: '2018-09',
      end: '2022-06',
      gpa: '3.7',
    },
  ],
  experience: [
    {
      company: 'Acme AI',
      title: 'AI Engineer',
      location: 'San Jose, CA',
      start: '2025-06',
      type: 'full-time',
    },
    {
      company: 'Beta Labs',
      title: 'Software Engineer Intern',
      location: 'San Jose, CA',
      start: '2024-05',
      end: '2025-05',
      type: 'internship',
    },
    {
      company: 'Gamma Tech',
      title: 'Software Engineer',
      location: 'Shanghai, China',
      start: '2022-02',
      end: '2023-08',
      type: 'full-time',
    },
  ],
  languages: ['English', 'Mandarin'],
  answers: { earliestStart: 'Two weeks after an offer', salary: '' },
};

export function makeProfile(overrides: Partial<ProfileInput> = {}): Profile {
  const parsed = parseProfile({ ...OPT_APPLICANT, ...overrides });
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return parsed.profile;
}
