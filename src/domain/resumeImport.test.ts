import { expect, it } from 'vitest';
import { applyResume, emptyProfile, resumeFactsSchema } from './profile';

it('imports only selected sections into a draft, preserving existing contact details and sensitive preferences', () => {
  const saved = emptyProfile();
  saved.name = { ...saved.name, first: 'Existing', last: 'Owner' };
  saved.phone = 'existing-phone';
  saved.skills = ['TypeScript'];
  saved.workAuthorization.sponsorshipFuture = true;
  saved.writing.summary = 'My edited summary';
  const original = structuredClone(saved);
  const facts = resumeFactsSchema.parse({
    name: { first: 'New', last: 'Resume' },
    phone: 'new-phone',
    skills: ['typescript', 'SQL'],
    summary: 'Extracted summary',
    experience: [{ company: 'Example', title: 'Engineer', start: '2022-01' }],
  });
  const draft = applyResume(saved, facts, {
    contact: true,
    education: false,
    experience: false,
    skills: true,
    summary: true,
  });
  expect(saved).toEqual(original);
  expect(draft.name.first).toBe('Existing');
  expect(draft.phone).toBe('existing-phone');
  expect(draft.experience).toEqual([]);
  expect(draft.skills).toEqual(['TypeScript', 'SQL']);
  expect(draft.writing.summary).toBe('My edited summary');
  expect(draft.workAuthorization).toEqual(original.workAuthorization);
  expect(draft.eeo).toEqual(original.eeo);
});
