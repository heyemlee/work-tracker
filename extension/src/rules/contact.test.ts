import { describe, expect, it } from 'vitest';
import type { FieldKind, ScannedField } from '../model';
import { planForm } from '../plan';
import { makeProfile } from '../test/profiles';
import { pickOption } from './options';

function answerFor(label: string, options: string[]) {
  const field: ScannedField = {
    id: '0:1',
    label,
    description: '',
    kind: 'combobox',
    options,
    required: true,
    hint: null,
    section: '',
    entry: null,
    filled: false,
    maxLength: null,
  };
  const ctx = {
    profile: makeProfile(),
    email: 'alex@example.com',
    resumeId: null,
    posting: null,
    today: '2026-09-28',
    appliedBefore: false,
  };
  const [planned] = planForm([field], ctx, []);
  const answer = planned?.answer;
  if (answer?.type !== 'choice') return null;
  return answer.option ?? pickOption(options, answer.want);
}

// Workday lists the minor islands ahead of the country, and spells the country out.
const WORKDAY = [
  'Canada (+1)',
  'Puerto Rico (+1)',
  'United States Minor Outlying Islands (+1)',
  'United States of America (+1)',
];

describe('picking the United States', () => {
  it('for the phone code, where many countries share +1', () => {
    expect(answerFor('Country Phone Code', WORKDAY)).toBe('United States of America (+1)');
    expect(
      answerFor('Country Phone Code', [
        'Canada (+1)',
        'United States (+1)',
        'United States Minor Outlying Islands (+1)',
      ]),
    ).toBe('United States (+1)');
  });

  it('for the country, spelled out or not', () => {
    const names = WORKDAY.map((option) => option.replace(' (+1)', ''));
    expect(answerFor('Country', names)).toBe('United States of America');
    expect(answerFor('Country', ['United States Minor Outlying Islands', 'United States', 'Uruguay'])).toBe(
      'United States',
    );
  });
});

describe('the country, in a list that names countries in short', () => {
  // The end of Stripe's list, which its dropdown and its boxes both carry.
  const SHORT = ['Singapore', 'South Korea', 'The Netherlands', 'UAE', 'UK', 'US'];
  const HOME = 'Please select the country where you currently reside.';
  const WORK =
    'Please select the country or countries you anticipate working in for the role in which you are applying.';
  const plan = (label: string, kind: FieldKind, options: string[], country = 'United States') =>
    planForm(
      [
        {
          id: '0:1',
          label,
          description: '',
          kind,
          options,
          required: true,
          hint: null,
          section: '',
          entry: null,
          filled: false,
          maxLength: null,
        },
      ],
      {
        profile: makeProfile({ address: { city: 'Santa Clara', state: 'CA', zip: '95050', country } }),
        email: 'alex@example.com',
        resumeId: null,
        posting: null,
        today: '2026-10-08',
        appliedBefore: false,
      },
      [],
    )[0];

  it('ticks the box that carries it, where the plan held a name no box had', () => {
    expect(plan(WORK, 'multi', SHORT)).toMatchObject({
      status: 'filled',
      key: 'workCountries',
      answer: { type: 'choice', option: 'US' },
    });
  });

  it('finds the United Kingdom and the Emirates the same way, in boxes and in a dropdown', () => {
    const lives = [
      ['United Kingdom', 'UK'],
      ['Great Britain', 'UK'],
      ['United Arab Emirates', 'UAE'],
      ['UAE', 'UAE'],
      ['Netherlands', 'The Netherlands'],
    ] as const;
    for (const [country, option] of lives) {
      expect(plan(WORK, 'multi', SHORT, country)?.answer).toMatchObject({ option });
      expect(plan(HOME, 'combobox', SHORT, country)?.answer).toMatchObject({ option });
    }
  });

  it('finds it spelled out all the same', () => {
    const full = ['United Arab Emirates', 'United Kingdom', 'United States'];
    expect(plan(WORK, 'multi', full)?.answer).toMatchObject({ option: 'United States' });
    expect(plan(WORK, 'multi', full, 'UK')?.answer).toMatchObject({ option: 'United Kingdom' });
    expect(plan(WORK, 'multi', full, 'U.A.E.')?.answer).toMatchObject({ option: 'United Arab Emirates' });
  });

  it('takes one box for a country of several names, not one for each name', () => {
    // "America" is the last of the United States' names, and a word of this region's.
    expect(plan(HOME, 'multi', ['Latin America', 'United States'])?.answer).toMatchObject({
      type: 'choice',
      option: 'United States',
    });
  });

  it('leaves the boxes to the owner when none carries it', () => {
    expect(plan(WORK, 'multi', ['Canada', 'Mexico'])).toMatchObject({
      status: 'missing',
      answer: null,
      note: 'no matching option',
    });
  });

  it('types it as the profile spells it', () => {
    expect(plan(WORK, 'text', [])?.answer).toEqual({ type: 'text', text: 'United States' });
    expect(plan(WORK, 'text', [], 'UK')?.answer).toEqual({ type: 'text', text: 'UK' });
  });
});

describe('phone fields', () => {
  const plan = (label: string, required: boolean) =>
    planForm(
      [
        {
          id: '0:1',
          label,
          description: '',
          kind: 'tel',
          options: [],
          required,
          hint: null,
          section: '',
          entry: null,
          filled: false,
          maxLength: null,
        },
      ],
      {
        profile: makeProfile(),
        email: 'alex@example.com',
        resumeId: null,
        posting: null,
        today: '2026-09-28',
        appliedBefore: false,
      },
      [],
    )[0];

  it('fills the number and leaves the extension empty', () => {
    expect(plan('Phone Number', true)?.answer).toEqual({ type: 'text', text: '+1 408-555-0100' });
    expect(plan('Phone Extension', false)).toMatchObject({ status: 'skipped', answer: null });
    expect(plan('Ext.', false)?.answer).toBeNull();
  });
});
