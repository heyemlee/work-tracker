import { describe, expect, it } from 'vitest';
import type { ScannedField } from './model';
import { aiCandidates, planForm } from './plan';
import { memoryKey, remember } from './rules/memory';
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

describe('a field the form names itself, with nothing for it in the profile', () => {
  const blank = { ...ctx, profile: makeProfile({ name: { first: 'Alex', last: 'Chen', preferred: '' } }) };
  // Greenhouse's own "Preferred First Name": the adapter knows it by its id, whatever the form calls it.
  const preferred: ScannedField = {
    ...whyUs(false),
    label: 'Preferred First Name',
    kind: 'text',
    required: false,
    hint: 'name.preferred',
  };
  const typed = (field: ScannedField, text: string) => ({
    key: memoryKey(field),
    label: field.label,
    answer: { type: 'text' as const, text },
    uses: 4,
    updatedAt: '2026-10-06T00:00:00.000Z',
  });

  it('takes what the owner typed there last time', () => {
    expect(planForm([preferred], blank, [])[0]).toMatchObject({ status: 'skipped', answer: null });
    expect(planForm([preferred], blank, [typed(preferred, 'Lucas')])[0]).toMatchObject({
      status: 'filled',
      answer: { type: 'text', text: 'Lucas' },
      source: 'memory',
      key: 'memory',
    });
  });

  it('goes by the profile once it has an answer', () => {
    expect(planForm([preferred], ctx, [typed(preferred, 'Lucas')])[0]).toMatchObject({
      answer: { type: 'text', text: 'Al' },
      source: 'rule',
      key: 'name.preferred',
    });
  });

  it('leaves one of several alike empty: a remembered end year says nothing of which school', () => {
    const noDates = {
      ...ctx,
      profile: makeProfile({ education: [{ school: 'Santa Clara University', level: 'master' }] }),
    };
    const year: ScannedField = {
      ...whyUs(false),
      label: 'End date year',
      kind: 'number',
      hint: 'education.end',
      entry: { kind: 'education', index: 0 },
    };
    expect(planForm([year], noDates, [typed(year, '2025')])[0]).toMatchObject({ answer: null });
  });
});

describe('an answer AI wrote last time, sent as it was', () => {
  const often: ScannedField = { ...whyUs(false), label: 'How often do you use our product?', kind: 'text' };
  const entry = {
    key: memoryKey(often),
    label: often.label,
    answer: { type: 'text' as const, text: 'Weekly' },
    uses: 1,
    updatedAt: '2026-10-06T00:00:00.000Z',
  };

  it('is AI’s still: a draft to check, said to be AI’s', () => {
    expect(planForm([often], ctx, [{ ...entry, byAi: true }])[0]).toMatchObject({
      status: 'draft',
      answer: { type: 'text', text: 'Weekly' },
      source: 'ai',
    });
  });

  it('is the owner’s once they wrote it', () => {
    expect(planForm([often], ctx, [entry])[0]).toMatchObject({ status: 'filled', source: 'memory' });
  });
});

describe('what was typed in a field last time, beside a rule for it', () => {
  // A site that doesn't name its fields: the email is known by its label alone.
  const email: ScannedField = { ...whyUs(false), label: 'Email', kind: 'email', required: true };
  const typedBefore = {
    key: memoryKey(email),
    label: email.label,
    answer: { type: 'text' as const, text: 'alice@old.example.com' },
    uses: 1,
    updatedAt: '2026-10-06T00:00:00.000Z',
  };

  it('gives way to the email of the account chosen on the card', () => {
    expect(planForm([email], ctx, [typedBefore])[0]).toMatchObject({
      answer: { type: 'text', text: 'alex@example.com' },
      source: 'rule',
    });
  });

  it('fills the field where the account has no email', () => {
    expect(planForm([email], { ...ctx, email: '' }, [typedBefore])[0]).toMatchObject({
      answer: { type: 'text', text: 'alice@old.example.com' },
      source: 'memory',
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

  it("gives no reference the owner's email", () => {
    // ExactCare's Workday form, its text run together as the page draws it.
    const reference = question(
      'Please provide the following information for your first professional reference:NameJob TitleCompanyProfessional RelationshipPhone NumberEmail Address',
      'textarea',
    );
    expect(answer(reference)).toMatchObject({ key: 'reference', status: 'missing', answer: null });
    expect(answer(question('Reference Email Address', 'email'))).toMatchObject({ answer: null });
    expect(answer(question('Reference Phone Number', 'tel'))).toMatchObject({ answer: null });
  });

  it('says yes to meeting the attendance the job asks for, as to its essential functions', () => {
    expect(
      answer(
        question('Are you able to meet the attendance requirements listed in the job description?', 'radio', [
          'Yes',
          'No',
        ]),
      ),
    ).toMatchObject({ key: 'essentialFunctions', answer: { option: 'Yes' } });
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

describe('a question with no label', () => {
  // Cursor's radios were read without their questions: every Yes or No without one is the same "question".
  const unnamed: ScannedField = { ...whyUs(false), label: '', kind: 'radio', options: ['Yes', 'No'] };
  const yes = { type: 'choice' as const, want: { kind: 'like' as const, texts: ['Yes'] }, option: 'Yes' };

  it('is neither remembered nor answered from memory', () => {
    expect(remember([], unnamed, yes, '2026-10-20T00:00:00.000Z')).toEqual([]);
    const kept = [
      { key: memoryKey(unnamed), label: '', answer: yes, uses: 3, updatedAt: '2026-10-19T00:00:00.000Z' },
    ];
    expect(planForm([unnamed], ctx, kept)[0]).toMatchObject({ status: 'missing', answer: null });
  });
});

describe('a phone number asked for without its country code', () => {
  const number = (phone: string) =>
    planForm(
      [{ ...whyUs(false), label: 'Phone', kind: 'text', hint: 'phone.national' }],
      { ...ctx, profile: makeProfile({ phone }) },
      [],
    )[0];

  it('leaves the code out, however the number is written', () => {
    expect(number('+1 408-555-0100')).toMatchObject({ key: 'phone', answer: { text: '408-555-0100' } });
    expect(number('+1 (408) 555-0100')).toMatchObject({ answer: { text: '(408) 555-0100' } });
    expect(number('+14085550100')).toMatchObject({ answer: { text: '408-555-0100' } });
    expect(number('+86 138 0013 8000')).toMatchObject({ answer: { text: '138 0013 8000' } });
    expect(number('408-555-0100')).toMatchObject({ answer: { text: '408-555-0100' } });
  });
});

describe('a group of boxes none of which carries the answer', () => {
  // A list of offices to tick, none of them in Santa Clara: the plan used to count the question as filled.
  const offices = question('In what location(s) are you available to work?', 'multi', [
    'San Francisco',
    'San Jose (Campbell)',
    'Remote',
  ]);

  it('is the owner’s to fill, and AI’s to try, as a dropdown would be', () => {
    const plan = planForm([offices], ctx, []);
    expect(plan[0]).toMatchObject({
      status: 'missing',
      key: 'location',
      answer: null,
      note: 'no matching option',
    });
    expect(aiCandidates([offices], plan)).toEqual([offices]);
  });
});
