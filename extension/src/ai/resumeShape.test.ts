import { resumeFactsSchema } from '@domain/profile';
import { describe, expect, it } from 'vitest';
import { resumeShape, toMonth } from './resumeShape';

const read = (raw: unknown) => resumeFactsSchema.parse(resumeShape(raw));

describe('a resume answer that ignored the schema', () => {
  // The shape a proxied model returned: location as a line, an extra email, free-form entries.
  const answer = {
    name: { first: 'Alex', last: 'Chen', preferred: 'Al' },
    email: 'alex@example.com',
    phone: '408-555-0100',
    location: 'San Jose, CA',
    links: ['https://www.linkedin.com/in/alex-chen', 'github.com/alexchen', 'https://alexchen.dev'],
    education: [
      {
        institution: 'Santa Clara University',
        degree: 'M.S.',
        major: 'Computer Science',
        dates: 'Sep 2023 – Jun 2025',
        gpa: 3.9,
      },
    ],
    experience: [
      {
        company: 'Acme AI',
        position: 'AI Engineer',
        location: 'San Jose, CA',
        start_date: 'Jun 2025',
        end_date: 'Present',
        responsibilities: ['• Built an agent evaluation harness', 'Cut latency 40%'],
      },
      { employer: 'Beta Labs', title: 'Software Engineer Intern', dates: '2024', description: null },
    ],
    skills: { languages: ['Python', 'TypeScript'], tools: 'Docker, Postgres' },
    summary: null,
  };

  it('reads contact details and links', () => {
    const facts = read(answer);
    expect(facts.name).toEqual({ first: 'Alex', last: 'Chen', preferred: 'Al' });
    expect(facts.phone).toBe('408-555-0100');
    expect(facts.location).toEqual({ city: 'San Jose', state: 'CA', country: '' });
    expect(facts.links).toEqual({
      linkedin: 'https://www.linkedin.com/in/alex-chen',
      github: 'github.com/alexchen',
      website: 'https://alexchen.dev',
    });
  });

  it('reads schools and jobs under other names, with their dates and bullets', () => {
    const facts = read(answer);
    expect(facts.education[0]).toMatchObject({
      school: 'Santa Clara University',
      degree: 'M.S.',
      level: 'master',
      field: 'Computer Science',
      start: '2023-09',
      end: '2025-06',
      gpa: '3.9',
    });
    expect(facts.experience[0]).toMatchObject({
      company: 'Acme AI',
      title: 'AI Engineer',
      start: '2025-06',
      end: '',
      type: 'full-time',
      description: '- Built an agent evaluation harness\n- Cut latency 40%',
    });
    expect(facts.experience[1]).toMatchObject({
      company: 'Beta Labs',
      type: 'internship',
      start: '2024-01',
      end: '',
    });
  });

  it('flattens grouped skills', () => {
    expect(read(answer).skills).toEqual(['Python', 'TypeScript', 'Docker', 'Postgres']);
  });

  it('leaves an answer that follows the schema as it is', () => {
    const exact = {
      name: { first: 'Alex', last: 'Chen', preferred: '' },
      phone: '+1 408-555-0100',
      location: { city: 'Santa Clara', state: 'CA', country: 'United States' },
      links: { linkedin: 'https://www.linkedin.com/in/alex-chen', github: '', website: '' },
      education: [
        {
          school: 'SCU',
          degree: 'MS',
          level: 'master',
          field: 'CS',
          start: '2023-09',
          end: '2025-06',
          gpa: '',
          location: '',
        },
      ],
      experience: [
        {
          company: 'Acme AI',
          title: 'AI Engineer',
          location: '',
          start: '2025-06',
          end: '',
          type: 'contract',
          description: '- Built agents',
        },
      ],
      skills: ['Python'],
      languages: ['English'],
      summary: 'Builds agents.',
    };
    expect(read(exact)).toEqual(resumeFactsSchema.parse(exact));
  });
});

describe('toMonth', () => {
  it.each([
    ['Jun 2025', false, '2025-06'],
    ['June, 2025', false, '2025-06'],
    ['06/2025', false, '2025-06'],
    ['2025-6', false, '2025-06'],
    ['2025-06', true, '2025-06'],
    ['2024', false, '2024-01'],
    ['2024', true, '2024-12'],
    ['Present', true, ''],
    ['至今', true, ''],
  ])('%s → %s', (value, end, month) => {
    expect(toMonth(value, end)).toBe(month);
  });
});
