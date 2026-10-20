import { describe, expect, it } from 'vitest';
import type { FieldKind, ScannedField } from '../model';
import { planForm } from '../plan';
import { makeProfile } from '../test/profiles';
import { findOption } from '../text';
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
    // Eightfold's, by country code: the minor islands (UM) ahead of the country (US).
    expect(
      answerFor('Country Code', [
        '🇺🇬 (+256) Uganda',
        '🇺🇲 (+1) United States Minor Outlying Islands',
        '🇺🇸 (+1) United States of America',
      ]),
    ).toBe('🇺🇸 (+1) United States of America');
  });

  it('for the country, spelled out or not', () => {
    const names = WORKDAY.map((option) => option.replace(' (+1)', ''));
    expect(answerFor('Country', names)).toBe('United States of America');
    expect(answerFor('Country', ['United States Minor Outlying Islands', 'United States', 'Uruguay'])).toBe(
      'United States',
    );
  });

  it('by the state, where a list of states asks where a US resident lives', () => {
    // Aura's Greenhouse form: "I am not a US resident" first, then the states.
    const RESIDENCE = ['I am not a US resident', 'Alabama', 'California', 'Colorado'];
    expect(answerFor('What is your country of residence?', RESIDENCE)).toBe('California');
    // As the dropdown is filled, its options read only once it's open.
    expect(findOption(RESIDENCE, ['United States', 'USA', 'US', 'California'])).toBe('California');
    expect(findOption(['Non-US citizen', 'US citizen'], ['US'])).toBe('US citizen');
  });

  it('in a list that names countries in Chinese', () => {
    // Eightfold's, for a browser that asks for Chinese.
    expect(answerFor('Country', ['阿富汗', '英国', '美国', '美属萨摩亚'])).toBe('美国');
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

describe('the applicant’s country, from a list', () => {
  const plan = (label: string, kind: FieldKind, options: string[]) =>
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
        profile: makeProfile(),
        email: 'alex@example.com',
        resumeId: null,
        posting: null,
        today: '2026-10-14',
        appliedBefore: false,
      },
      [],
    )[0];
  const picked = (label: string, kind: FieldKind, options: string[]) => {
    const answer = plan(label, kind, options)?.answer;
    return answer?.type === 'choice' ? answer.option : null;
  };
  const WORK = 'Which countries will you work in?';

  it('ticks no region that merely has "America" in it, nor an island with "U.S." in it', () => {
    expect(picked(WORK, 'multi', ['APAC', 'EMEA', 'Latin America', 'North America'])).toBeNull();
    expect(picked(WORK, 'multi', ['Canada', 'U.S. Virgin Islands'])).toBeNull();
  });

  it('takes any of the country’s names the list has as a whole, before one inside another', () => {
    expect(picked(WORK, 'multi', ['UK', 'US', 'Canada'])).toBe('US');
    expect(picked('Country', 'select', ['United States Minor Outlying Islands', 'USA'])).toBe('USA');
    expect(picked('Country', 'select', ['Canada', 'United States (US)'])).toBe('United States (US)');
  });
});
