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
