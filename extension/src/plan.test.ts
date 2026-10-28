import { describe, expect, it } from 'vitest';
import type { ScannedField } from './model';
import { aiCandidates, planForm } from './plan';
import { memoryKey, remember } from './rules/memory';
import { fits } from './rules/resolve';
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

describe('a field the form doesn’t mark as required', () => {
  const optional = (id: string, field: Partial<ScannedField>): ScannedField => ({
    ...whyUs(false),
    id,
    required: false,
    ...field,
  });

  it('is left empty, whatever the profile, a rule or memory has for it', () => {
    const fields = [
      optional('0:1', { label: 'LinkedIn Profile', kind: 'url', hint: 'links.linkedin' }),
      optional('0:2', { label: 'Phone', kind: 'tel', hint: 'phone' }),
      optional('0:3', {
        label: 'Will you now or in the future require sponsorship?',
        kind: 'radio',
        options: ['Yes', 'No'],
      }),
      optional('0:4', { label: 'What is your favorite programming language?', kind: 'text' }),
    ];
    const typed = {
      key: memoryKey(fields[3]!),
      label: fields[3]!.label,
      answer: { type: 'text' as const, text: 'TypeScript' },
      uses: 2,
      updatedAt: '2026-10-06T00:00:00.000Z',
    };
    for (const entry of planForm(fields, ctx, [typed]))
      expect(entry).toMatchObject({ status: 'skipped', answer: null, source: null });
  });

  it('is the voluntary survey’s, answered from the profile all the same', () => {
    const gender = optional('0:1', {
      label: 'Gender',
      kind: 'select',
      options: ['Male', 'Female', 'Decline to self-identify'],
    });
    const owner = makeProfile({ eeo: { gender: 'female' } });
    expect(planForm([gender], { ...ctx, profile: owner }, [])[0]).toMatchObject({
      status: 'filled',
      key: 'eeo.gender',
      answer: { option: 'Female' },
    });
  });

  it('keeps what the page holds', () => {
    const phone = optional('0:1', { label: 'Phone', kind: 'tel', hint: 'phone', filled: true });
    expect(planForm([phone], ctx, [])[0]).toMatchObject({
      status: 'filled',
      answer: null,
      note: 'already filled',
    });
  });

  it('takes the resume picked on the card all the same', () => {
    const resume = optional('0:1', { label: 'Resume/CV', kind: 'file', hint: 'resume' });
    expect(planForm([resume], { ...ctx, resumeId: 'resume-1' }, [])[0]).toMatchObject({
      status: 'filled',
      answer: { type: 'file', resumeId: 'resume-1' },
    });
  });

  it('is a job’s "I currently work here" only where the job’s end date is asked for', () => {
    const job = { kind: 'experience' as const, index: 0 };
    const current = optional('0:1', {
      label: 'I currently work here',
      kind: 'checkbox',
      hint: 'experience.current',
      entry: job,
    });
    const end = (required: boolean) =>
      optional('0:2', { label: 'To', kind: 'date', hint: 'experience.end', entry: job, required });
    // The newest job goes on: the box is the end date's "Present", and the date itself is left out.
    expect(planForm([current, end(true)], ctx, [])).toMatchObject([
      { status: 'filled', answer: { type: 'check', checked: true } },
      { status: 'skipped', answer: null },
    ]);
    expect(planForm([current, end(false)], ctx, [])[0]).toMatchObject({ status: 'skipped', answer: null });
  });
});

describe('a field the form names itself, with nothing for it in the profile', () => {
  const blank = {
    ...ctx,
    profile: makeProfile({ address: { city: '', state: 'CA', zip: '95050', country: 'United States' } }),
  };
  // Workday's own "City": the adapter knows it by its id, whatever the form calls it. Asked for: one that isn't is
  // left empty.
  const city: ScannedField = { ...whyUs(false), label: 'City', kind: 'text', hint: 'address.city' };
  const typed = (field: ScannedField, text: string) => ({
    key: memoryKey(field),
    label: field.label,
    answer: { type: 'text' as const, text },
    uses: 4,
    updatedAt: '2026-10-06T00:00:00.000Z',
  });

  it('takes what the owner typed there last time', () => {
    expect(planForm([city], blank, [])[0]).toMatchObject({ status: 'missing', answer: null });
    expect(planForm([city], blank, [typed(city, 'Sunnyvale')])[0]).toMatchObject({
      status: 'filled',
      answer: { type: 'text', text: 'Sunnyvale' },
      source: 'memory',
      key: 'memory',
    });
  });

  it('goes by the profile once it has an answer', () => {
    expect(planForm([city], ctx, [typed(city, 'Sunnyvale')])[0]).toMatchObject({
      answer: { type: 'text', text: 'Santa Clara' },
      source: 'rule',
      key: 'address.city',
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

describe('a date’s part with nothing to say whose', () => {
  // Lyft's current job took the end year typed on another form weeks before (2026-10-23).
  const endYear: ScannedField = { ...whyUs(false), label: 'End date year', kind: 'text', maxLength: 4 };
  const typed = { type: 'text' as const, text: '2025' };

  it('is neither remembered nor answered from memory, nor put to AI', () => {
    expect(remember([], endYear, typed, '2026-10-24T00:00:00.000Z')).toEqual([]);
    const kept = [
      {
        key: memoryKey(endYear),
        label: endYear.label,
        answer: typed,
        uses: 3,
        updatedAt: '2026-10-24T00:00:00.000Z',
      },
    ];
    const plan = planForm([endYear], ctx, kept);
    expect(plan[0]).toMatchObject({ status: 'missing', answer: null });
    expect(aiCandidates([endYear], plan)).toEqual([]);
  });

  it('isn’t when the owner can start', () => {
    const startMonth: ScannedField = { ...whyUs(false), label: 'Start date month', kind: 'combobox' };
    expect(planForm([startMonth], ctx, [])[0]).toMatchObject({ key: 'unknown', answer: null });
    const start: ScannedField = { ...whyUs(false), label: 'Start Date', kind: 'text' };
    expect(planForm([start], ctx, [])[0]).toMatchObject({ key: 'unknown', answer: null });
    expect(planForm([{ ...start, label: 'Desired start date' }], ctx, [])[0]).toMatchObject({
      key: 'startDate',
      answer: { text: 'Two weeks after an offer' },
    });
  });
});

describe('a second job or school on a form that doesn’t number them', () => {
  const field = (id: string, label: string): ScannedField => ({ ...whyUs(false), id, label, kind: 'text' });

  it('gets nothing: the newest one’s answers went to the first', () => {
    const fields = [
      field('0:1', 'Company name'),
      field('0:2', 'Title'),
      field('0:3', 'Company name'),
      field('0:4', 'Title'),
      field('0:5', 'School'),
      field('0:6', 'School'),
    ];
    expect(planForm(fields, ctx, []).map((entry) => entry.answer)).toEqual([
      { type: 'text', text: 'Acme AI' },
      { type: 'text', text: 'AI Engineer' },
      null,
      null,
      { type: 'text', text: 'Santa Clara University' },
      null,
    ]);
  });
});

describe('an answer the field can’t take', () => {
  const field = (label: string, kind: ScannedField['kind'] = 'text'): ScannedField => ({
    ...whyUs(false),
    label,
    kind,
  });

  it('is left for the owner, not cut to fit', () => {
    // "one week after an offer" went into Lyft's four-character year as "one" (2026-10-23).
    const start = field('When can you start?');
    expect(planForm([{ ...start, maxLength: 4 }], ctx, [])[0]).toMatchObject({
      status: 'missing',
      answer: null,
      key: 'startDate',
    });
    expect(planForm([{ ...start, maxLength: 255 }], ctx, [])[0]).toMatchObject({
      status: 'filled',
      answer: { text: 'Two weeks after an offer' },
    });
  });

  it('gives a box a yes or a no, never a name', () => {
    expect(planForm([field('Current role', 'checkbox')], ctx, [])[0]).toMatchObject({ answer: null });
    expect(fits(field('Current role', 'checkbox'), { type: 'text', text: 'AI Engineer' })).toBe(false);
    expect(fits(field('Current role', 'checkbox'), { type: 'check', checked: true })).toBe(true);
  });

  it('is a year in a bare year, a month in a bare month', () => {
    const like = (...texts: string[]) => ({
      type: 'choice' as const,
      want: { kind: 'like' as const, texts },
      option: null,
    });
    expect(fits(field('Start date year'), { type: 'text', text: '2025' })).toBe(true);
    expect(fits(field('Start date year'), { type: 'text', text: 'Two weeks after an offer' })).toBe(false);
    expect(fits(field('End date month', 'combobox'), like('June', 'Jun', '06'))).toBe(true);
    expect(fits(field('Start date month', 'combobox'), like('2 weeks', 'Immediately'))).toBe(false);
    // A question that names more than a date isn't one of its parts.
    expect(fits(field('What year will you complete your degree?'), { type: 'text', text: 'June 2025' })).toBe(
      true,
    );
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
