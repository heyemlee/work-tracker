import { describe, expect, it } from 'vitest';
import type { ScannedField } from './model';
import { planForm } from './plan';
import { makeProfile } from './test/profiles';

const ctx = {
  profile: makeProfile(),
  email: 'alex@example.com',
  resumeId: null,
  posting: null,
  today: '2026-09-28',
  appliedBefore: false,
};

const whyUs = (filled: boolean): ScannedField => ({
  id: '0:1',
  label: 'Why do you want to work here?',
  description: '',
  kind: 'textarea',
  options: [],
  required: true,
  hint: null,
  section: '',
  entry: null,
  filled,
  maxLength: null,
});

describe('planForm', () => {
  it('keeps a free-text answer the page already holds instead of drafting another', () => {
    expect(planForm([whyUs(false)], ctx, [])[0]).toMatchObject({ status: 'draft', answer: null });
    expect(planForm([whyUs(true)], ctx, [])[0]).toMatchObject({
      status: 'filled',
      answer: null,
      note: 'already filled',
    });
  });
});

const question = (label: string, kind: ScannedField['kind'], options: string[] = []): ScannedField => ({
  ...whyUs(false),
  label,
  kind,
  options,
});

const answer = (field: ScannedField) => planForm([field], ctx, [])[0];

describe("questions from the owner's snapshots", () => {
  it('says no to serving in the Reserves for someone on a visa, and leaves a military spouse to the owner', () => {
    expect(answer(question('Are you in the Reserves?', 'radio', ['Yes', 'No']))).toMatchObject({
      key: 'military',
      answer: { type: 'choice', option: 'No' },
    });
    expect(
      answer(
        question(
          'Palo Alto Networks prides itself on being a military friendly employer. Do you consider yourself as a Military Spouse / Domestic Partner?',
          'radio',
          ['Yes', 'No', 'Wish not to answer'],
        ),
      ),
    ).toMatchObject({ status: 'missing', answer: null });
  });

  it('reads "If this role requires relocation" as whether they would move', () => {
    expect(
      answer(
        question('If this role or future roles require relocation:', 'radio', [
          'I am willing to relocate',
          'I am not willing to relocate',
        ]),
      ),
    ).toMatchObject({ key: 'relocation', answer: { option: 'I am willing to relocate' } });
  });

  it('says whether the graduation falls in the terms a question names', () => {
    // The test applicant's latest degree ended in June 2025.
    const confirm = question(
      'I confirm that my graduation date will be either Fall 2026 or Spring 2027',
      'combobox',
    );
    expect(answer(confirm)).toMatchObject({ key: 'education.graduation', answer: { want: { kind: 'no' } } });
    expect(
      answer(question('Did you graduate between May 2025 and August 2025?', 'radio', ['Yes', 'No'])),
    ).toMatchObject({ answer: { option: 'Yes' } });
    expect(answer(question('Will you graduate in Spring 2025?', 'radio', ['Yes', 'No']))).toMatchObject({
      answer: { option: 'Yes' },
    });
    // A list of terms to pick from is answered by the term itself, as before.
    expect(
      answer(question('Graduation date (2024-2026 graduates)', 'select', ['2024', '2025', '2026'])),
    ).toMatchObject({ answer: { option: '2025' } });
  });
});
