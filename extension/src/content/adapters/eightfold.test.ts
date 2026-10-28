import { describe, expect, it } from 'vitest';
import { planForm } from '../../plan';
import { loadFixture } from '../../test/fixtures';
import { makeProfile } from '../../test/profiles';
import { applyAnswer } from '../apply';
import { extractFields } from '../extract';
import { eightfold } from './eightfold';
import { adapterFor } from '.';

// Eightfold's own page code drew this application for a visitor whose browser asks for Chinese: the form's own
// fields in Chinese, the employer's questions in English with their choices in Chinese (see the README).
const url = 'https://app.eightfold.ai/careers/apply?pid=68763148348&domain=eightfold.ai';
const page = () => loadFixture('eightfold/apply-zh.html', url);

const ctx = {
  profile: makeProfile({
    eeo: {
      gender: 'male',
      hispanic: 'no',
      race: 'asian',
      veteran: 'not',
      disability: 'no',
      orientation: 'decline',
    },
  }),
  email: 'alex@example.com',
  resumeId: 'res-1',
  posting: null,
  today: '2026-10-20',
  appliedBefore: false,
};

describe('Eightfold', () => {
  it('runs on its careers sites', () => {
    expect(adapterFor(url)).toBe(eightfold);
    expect(adapterFor('https://acme.eightfold.ai/careers/job/123')).toBe(eightfold);
    expect(adapterFor('https://eightfold.ai.example.test/careers/apply')).not.toBe(eightfold);
  });

  it('reads a form drawn in Chinese by what each field is', () => {
    const { fields } = extractFields(eightfold, page(), 0);
    expect(fields.map(({ label, kind, hint, required }) => ({ label, kind, hint, required }))).toEqual([
      { label: '上传您的简历', kind: 'file', hint: 'resume', required: true },
      { label: '国家/地区代码', kind: 'combobox', hint: 'phone.country', required: true },
      { label: '国家', kind: 'combobox', hint: 'address.country', required: true },
      // The employer's questions in their own words, from each choice's.
      { label: 'Are you currently eligible to work within the United States?', kind: 'radio', hint: null, required: false }, // prettier-ignore
      { label: 'Gender', kind: 'radio', hint: null, required: false },
      { label: 'What is your race/ethnicity?', kind: 'radio', hint: null, required: false },
      // "Please check one of the boxes:", under the heading that says what about.
      { label: 'Disability Status', kind: 'radio', hint: null, required: false },
      { label: 'Veteran Status', kind: 'radio', hint: null, required: false },
      { label: '电子邮件', kind: 'text', hint: 'email', required: true },
      { label: '名', kind: 'text', hint: 'name.first', required: true },
      { label: '姓', kind: 'text', hint: 'name.last', required: true },
      // By its own placeholder: "电话" is the heading over it and the code beside it, which has a name of its own.
      { label: '电话号码', kind: 'text', hint: 'phone.national', required: true },
      { label: '城市', kind: 'text', hint: 'address.city', required: true },
      {
        label: 'Will you now, or in the future, require visa sponsorship? If so, please explain.',
        kind: 'textarea',
        hint: null,
        required: false,
      },
    ]);
    // The choices as they were written, not as the page shows them (是, 否; 男性, 女性…).
    expect(fields.find((field) => field.label === 'Gender')?.options).toEqual([
      'Male',
      'Female',
      'Decline to Self Identify',
    ]);
    // Eightfold's own "Save my answers for future applications" box isn't the employer's question.
    expect(fields.some((field) => /保存/.test(field.label))).toBe(false);
  });

  it('leaves what it doesn’t ask for empty, but for the survey', () => {
    const { fields } = extractFields(eightfold, page(), 0);
    const plan = planForm(fields, ctx, []);
    const at = (label: string) => plan[fields.findIndex((field) => field.label === label)];
    expect(at('Are you currently eligible to work within the United States?')).toMatchObject({
      status: 'skipped',
      answer: null,
    });
    expect(at('Gender')).toMatchObject({ status: 'filled', answer: { option: 'Male' } });
    expect(at('Veteran Status')).toMatchObject({
      status: 'filled',
      answer: { option: 'I AM NOT A PROTECTED VETERAN' },
    });
  });

  it('answers it from the profile', () => {
    const { fields } = extractFields(eightfold, page(), 0);
    // Every question asked for, as another employer's form may ask them: which this one leaves optional is above.
    const plan = planForm(
      fields.map((field) => ({ ...field, required: true })),
      ctx,
      [],
    );
    const answer = (label: string) => {
      const at = fields.findIndex((field) => field.label === label);
      return plan[at];
    };
    expect(answer('电子邮件')).toMatchObject({ status: 'filled', answer: { text: 'alex@example.com' } });
    expect(answer('名')).toMatchObject({ status: 'filled', answer: { text: 'Alex' } });
    // The number alone: the code is chosen beside it, and the box takes only digits, dashes and brackets.
    expect(answer('电话号码')).toMatchObject({ status: 'filled', answer: { text: '408-555-0100' } });
    expect(answer('上传您的简历')).toMatchObject({
      status: 'filled',
      answer: { type: 'file', resumeId: 'res-1' },
    });
    expect(answer('Are you currently eligible to work within the United States?')).toMatchObject({
      status: 'confirm',
      answer: { option: 'Yes' },
    });
    expect(answer('Gender')).toMatchObject({ answer: { option: 'Male' } });
    expect(answer('What is your race/ethnicity?')).toMatchObject({ answer: { option: 'Asian' } });
    expect(answer('Disability Status')).toMatchObject({
      answer: { option: 'No, I do not have a disability and have not had one in the past' },
    });
    expect(answer('Veteran Status')).toMatchObject({ answer: { option: 'I AM NOT A PROTECTED VETERAN' } });
  });

  it('ticks a choice by its own words where the page shows others', async () => {
    const doc = page();
    const { fields, handles } = extractFields(eightfold, doc, 0);
    const gender = fields.find((field) => field.label === 'Gender')!;
    expect(
      await applyAnswer(
        handles.get(gender.id)!,
        { type: 'choice', want: { kind: 'eeo', field: 'gender', value: 'male' }, option: 'Male' },
        async () => null,
      ),
    ).toEqual({ ok: true, value: 'Male' });
    expect(doc.querySelector<HTMLInputElement>('[id$="__gender-male"]')!.checked).toBe(true);
  });

  it('names the posting, its company and its own page', () => {
    expect(eightfold.posting(page(), url)).toMatchObject({
      ats: 'eightfold',
      title: 'Software Engineer - AI Agentic Product Dev Team (US)',
      company: 'Eightfold',
      location: 'Santa Clara, CA',
      url: 'https://app.eightfold.ai/careers/job/68763148348?domain=eightfold.ai',
    });
    // A company's site on Eightfold's host is named by its domain, not by the host.
    expect(eightfold.posting(page(), url.replace('domain=eightfold.ai', 'domain=acme.com'))).toMatchObject({
      company: 'Acme',
    });
  });

  it('knows its thanks, in whatever words', () => {
    const doc = page();
    expect(eightfold.confirmed(doc, url)).toBe(false);
    expect(eightfold.submitButton(doc)).toBe(doc.querySelector('[data-test-id="submitApplicationButton"]'));
    doc.body.insertAdjacentHTML(
      'beforeend',
      '<div role="dialog"><h2 id="form-submission-success-message" tabindex="-1">您的申请已提交！</h2></div>',
    );
    expect(eightfold.confirmed(doc, url)).toBe(true);
  });
});
