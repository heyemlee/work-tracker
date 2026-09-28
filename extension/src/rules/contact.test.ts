import { describe, expect, it } from 'vitest';
import type { ScannedField } from '../model';
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
