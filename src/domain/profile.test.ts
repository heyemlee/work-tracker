import { describe, expect, it } from 'vitest';
import {
  applyResume,
  completeness,
  emptyProfile,
  MISSING_WEIGHTS,
  missingItems,
  resumeAdditions,
  resumeContact,
  resumeFactsSchema,
  type Profile,
} from './profile';

const ALL = { contact: true, education: true, experience: true, skills: true, summary: true };

const facts = resumeFactsSchema.parse({
  name: { first: 'Alex', last: 'Chen' },
  phone: '+1 408-555-0100',
  location: { city: 'Santa Clara', state: 'CA', country: 'United States' },
  links: { linkedin: 'https://www.linkedin.com/in/alex-chen', github: 'https://github.com/alexchen' },
  education: [
    {
      school: 'Santa Clara University',
      degree: 'MS',
      level: 'master',
      field: 'Computer Science',
      start: '2023-09',
      end: '2025-06',
    },
    { school: '', degree: 'Certificate' },
  ],
  experience: [
    { company: 'Acme AI', title: 'AI Engineer', start: '2025-06', end: '', description: '- Built agents' },
    { company: 'Beta Labs', title: 'Intern', start: 'Summer 2024', end: '2024-08', type: 'internship' },
  ],
  skills: ['Python', 'TypeScript', 'python'],
  languages: ['English', 'Mandarin'],
  summary: 'AI engineer who ships agents.',
});

function withName(): Profile {
  const profile = emptyProfile();
  return {
    ...profile,
    name: { ...profile.name, first: 'Alexander', last: 'Chen' },
    skills: ['Go', 'TypeScript'],
  };
}

describe('reading a resume into the profile', () => {
  it('fills only the contact details the profile leaves empty', () => {
    expect(resumeContact(withName(), facts).map((entry) => entry.field)).toEqual([
      'phone',
      'city',
      'state',
      'linkedin',
      'github',
    ]);
    const next = applyResume(withName(), facts, ALL);
    expect(next.name.first).toBe('Alexander');
    expect(next.phone).toBe('+1 408-555-0100');
    expect(next.address).toMatchObject({ city: 'Santa Clara', state: 'CA', country: 'United States' });
  });

  it('replaces education and experience, keeping undated starts for the owner to fill', () => {
    const next = applyResume(withName(), facts, ALL);
    expect(next.education).toEqual([
      expect.objectContaining({
        school: 'Santa Clara University',
        level: 'master',
        start: '2023-09',
        end: '2025-06',
      }),
    ]);
    expect(next.experience.map((job) => [job.company, job.start, job.end, job.type])).toEqual([
      ['Acme AI', '2025-06', null, 'full-time'],
      ['Beta Labs', '', '2024-08', 'internship'],
    ]);
  });

  it('adds new skills and languages without repeating any', () => {
    expect(resumeAdditions(['Go', 'TypeScript'], facts.skills)).toEqual(['Python']);
    const next = applyResume(withName(), facts, ALL);
    expect(next.skills).toEqual(['Go', 'TypeScript', 'Python']);
    expect(next.languages).toEqual(['English', 'Mandarin']);
  });

  it('leaves out the parts not chosen, and never touches work authorization or EEO', () => {
    const before = withName();
    const next = applyResume(before, facts, { ...ALL, experience: false, contact: false });
    expect(next.experience).toEqual([]);
    expect(next.phone).toBe('');
    expect(next.workAuthorization).toEqual(before.workAuthorization);
    expect(next.eeo).toEqual(before.eeo);
    expect(next.writing.summary).toBe('AI engineer who ships agents.');
  });

  it('counts a filled-in resume toward the checklist', () => {
    expect(missingItems(applyResume(withName(), facts, ALL))).toEqual([
      'address.zip',
      'workAuthorization.citizenship',
      'answers.salary',
      'answers.earliestStart',
    ]);
  });

  it('reads what a model returns loosely: unknown levels, missing parts', () => {
    const loose = resumeFactsSchema.parse({ education: [{ school: 'MIT', level: 'masters' }] });
    expect(loose.education[0]?.level).toBe('other');
    expect(loose.experience).toEqual([]);
    expect(loose.name.first).toBe('');
  });
});

describe('completeness', () => {
  it('weighs blanks to a total of 100', () => {
    expect(Object.values(MISSING_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  it('goes from 0 for an empty profile up as blanks fill in', () => {
    const profile = emptyProfile();
    expect(completeness(profile)).toBe(0);
    profile.workAuthorization.citizenship = ['China'];
    profile.phone = '(555) 010-0199';
    expect(completeness(profile)).toBe(30);
  });
});
