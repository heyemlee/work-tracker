import { describe, expect, it } from 'vitest';
import type { Want } from '../../model';
import { planForm } from '../../plan';
import { pickOption } from '../../rules/options';
import { makeProfile } from '../../test/profiles';
import { readAnswer } from '../apply';
import { extractFields } from '../extract';
import { formSnapshot } from '../snapshot';
import { workday } from './workday';

// Workday's forms sit behind a sign-in, so this page is built from its `data-automation-id` conventions rather than
// saved from a live form. Snapshots from real pages replace it as they come in.
const PAGE = `
<div data-automation-id="applyFlowPage">
  <div data-automation-id="progressBarActiveStep">My Experience</div>
  <div data-automation-id="formField-legalNameSection_firstName"><label for="first">First Name*</label><input id="first" data-automation-id="legalNameSection_firstName"></div>
  <div data-automation-id="formField-countryDropdown"><label>Country*</label><button aria-haspopup="listbox" data-automation-id="countryDropdown">Select One</button></div>
  <div data-automation-id="formField-source"><label>How Did You Hear About Us?*</label><div data-automation-id="multiSelectContainer"><input data-automation-id="searchBox"></div></div>
  <div data-automation-id="workExperienceSection">
    <button data-automation-id="Add">Add</button>
    <div data-automation-id="workExperience-1">
      <div data-automation-id="formField-jobTitle"><label for="title-1">Job Title*</label><input id="title-1" data-automation-id="jobTitle"></div>
      <div data-automation-id="formField-company"><label for="company-1">Company*</label><input id="company-1" data-automation-id="company"></div>
      <div data-automation-id="formField-currentlyWorkHere"><label for="current-1">I currently work here</label><input type="checkbox" id="current-1" data-automation-id="currentlyWorkHere"></div>
      <div data-automation-id="formField-startDate"><label>From*</label><div data-automation-id="dateInputWrapper"><input data-automation-id="dateSectionMonth-input"><input data-automation-id="dateSectionYear-input"></div></div>
    </div>
    <div data-automation-id="workExperience-2">
      <div data-automation-id="formField-jobTitle"><label for="title-2">Job Title*</label><input id="title-2" data-automation-id="jobTitle"></div>
      <div data-automation-id="formField-company"><label for="company-2">Company*</label><input id="company-2" data-automation-id="company"></div>
    </div>
  </div>
</div>`;

describe('workday', () => {
  document.body.innerHTML = PAGE;
  const { fields } = extractFields(workday, document, 0);
  const byLabel = (label: string, index = 0) => fields.filter((field) => field.label === label)[index];

  it('reads the step and names fields from their automation ids', () => {
    expect(workday.step?.(document)).toBe('My Experience');
    expect(byLabel('First Name')).toMatchObject({ hint: 'name.first', kind: 'text' });
    expect(byLabel('Country')).toMatchObject({ hint: 'address.country', kind: 'combobox', filled: false });
    expect(byLabel('How Did You Hear About Us?')).toMatchObject({ hint: 'howHeard', kind: 'typeahead' });
    expect(byLabel('From')).toMatchObject({ kind: 'date', entry: { kind: 'experience', index: 0 } });
  });

  it('ties each work-experience entry to a job, newest first', () => {
    const plan = planForm(
      fields,
      {
        profile: makeProfile(),
        email: 'alex@example.com',
        resumeId: null,
        posting: null,
        today: '2026-09-27',
        appliedBefore: false,
      },
      [],
    );
    const answerOf = (label: string, index: number) => {
      const field = byLabel(label, index);
      const answer = plan.find((entry) => entry.fieldId === field?.id)?.answer;
      return answer?.type === 'text'
        ? answer.text
        : answer?.type === 'check'
          ? answer.checked
          : answer?.type === 'date'
            ? answer.iso
            : null;
    };
    expect([answerOf('Job Title', 0), answerOf('Company', 0)]).toEqual(['AI Engineer', 'Acme AI']);
    expect([answerOf('Job Title', 1), answerOf('Company', 1)]).toEqual([
      'Software Engineer Intern',
      'Beta Labs',
    ]);
    expect(answerOf('I currently work here', 0)).toBe(true);
    expect(answerOf('From', 0)).toBe('2025-06-01');
  });
});

describe('workday, after "Autofill with Resume"', () => {
  const ctx = {
    profile: makeProfile(),
    email: 'alex@example.com',
    resumeId: null,
    posting: null,
    today: '2026-09-28',
    appliedBefore: false,
  };
  /** The page as Workday leaves it when it has read a resume: the first job filled in. */
  const parsed = () => {
    document.body.innerHTML = PAGE;
    document.querySelector<HTMLInputElement>('#title-1')!.value = 'Staff Engineer';
  };

  it('leaves the work experience it filled in to the page, and fills the rest from the profile', () => {
    parsed();
    const { fields } = extractFields(workday, document, 0);
    const plan = planForm(fields, ctx, []);
    const planned = (label: string, index = 0) =>
      plan.find((entry) => entry.fieldId === fields.filter((field) => field.label === label)[index]?.id);
    // The second entry's company is empty, but the page's jobs may not be in the profile's order.
    expect(planned('Job Title')).toMatchObject({ status: 'filled', answer: null });
    expect(planned('Company', 1)?.answer).toBeNull();
    expect(planned('From')).toMatchObject({ answer: null });
    expect(planned('First Name')?.answer).toEqual({ type: 'text', text: 'Alex' });
  });

  it('adds no entries to a section the page filled in', async () => {
    parsed();
    const section = document.querySelector('[data-automation-id="workExperienceSection"]')!;
    let added = 0;
    section.querySelector('button')!.addEventListener('click', () => {
      added++;
      section.insertAdjacentHTML('beforeend', `<div data-automation-id="workExperience-${2 + added}"></div>`);
    });
    const form = workday.form(document)!;
    expect(await workday.prepare!(form, { experience: 3, education: 0 })).toBe(false);
    expect(added).toBe(0);

    document.querySelector<HTMLInputElement>('#title-1')!.value = '';
    expect(await workday.prepare!(form, { experience: 3, education: 0 })).toBe(true);
    expect(added).toBe(1);
  });
});

// From the owner's snapshots (values stripped): a questionnaire in Chinese, and "My Information" with its
// preferred-name box inside the "Legal Name" section.
const ZH_QUESTIONS = `
<div data-automation-id="applyFlowPage">
  <div data-automation-id="formField-q1"><label>Are you a citizen of the United States?<abbr>*</abbr></label>
    <button aria-haspopup="listbox" type="button" value="" aria-label=" 选择一个 必需" id="primaryQuestionnaire--q1">选择一个</button></div>
  <div data-automation-id="formField-q2"><label>您是否以任何身份为雷神技术公司或其任何业务工作？<abbr>*</abbr></label>
    <button aria-haspopup="listbox" type="button" value="1d1eac2e" aria-label=" 否 必需" id="primaryQuestionnaire--q2">否</button></div>
</div>`;

const LEGAL_NAME = `
<div data-automation-id="applyFlowPage">
  <div role="group" aria-labelledby="Legal-Name-section"><h4 id="Legal-Name-section">Legal Name</h4>
    <div data-automation-id="formField-legalName--firstName"><label for="first"><span>Given Name(s)<abbr>*</abbr></span></label><input type="text" id="first" name="legalName--firstName"></div>
    <div data-automation-id="formField-preferredCheck"><label for="name--preferredCheck">I have a preferred name</label><input id="name--preferredCheck" type="checkbox" name="preferredCheck"></div>
  </div>
</div>`;

describe('workday pages from snapshots', () => {
  const ctx = {
    profile: makeProfile(),
    email: 'alex@example.com',
    resumeId: null,
    posting: null,
    today: '2026-09-30',
    appliedBefore: false,
  };

  it('reads a dropdown still prompting, in any language, as empty', () => {
    document.body.innerHTML = ZH_QUESTIONS;
    const { fields, handles } = extractFields(workday, document, 0);
    const [citizen, worked] = fields;
    expect(citizen).toMatchObject({ kind: 'combobox', filled: false });
    expect(readAnswer(handles.get(citizen!.id)!)).toBeNull();
    expect(worked).toMatchObject({ filled: true });
    expect(readAnswer(handles.get(worked!.id)!)).toMatchObject({ type: 'choice', option: '否' });
  });

  it('answers yes or no where the options are 是 and 否', () => {
    document.body.innerHTML = ZH_QUESTIONS;
    const { fields } = extractFields(workday, document, 0);
    const [entry] = planForm(fields.slice(0, 1), ctx, []);
    expect(entry).toMatchObject({ key: 'auth.citizen', status: 'confirm' });
    expect(pickOption(['是', '否'], (entry!.answer as { want: Want }).want)).toBe('否');
  });

  it('leaves "I have a preferred name" unticked without a preferred name', () => {
    document.body.innerHTML = LEGAL_NAME;
    const { fields } = extractFields(workday, document, 0);
    const box = fields.find((field) => field.kind === 'checkbox');
    expect(box?.label).toBe('I have a preferred name');
    const plan = planForm(
      fields,
      { ...ctx, profile: makeProfile({ name: { first: 'Alex', last: 'Chen' } }) },
      [],
    );
    expect(plan.find((entry) => entry.fieldId === box?.id)?.answer).toEqual({
      type: 'check',
      checked: false,
    });
    expect(planForm(fields, ctx, []).find((entry) => entry.fieldId === box?.id)?.answer).toEqual({
      type: 'check',
      checked: true,
    });
  });

  it('keeps chosen dropdown values out of a snapshot', () => {
    document.body.innerHTML = ZH_QUESTIONS;
    const extraction = extractFields(workday, document, 0);
    const shot = formSnapshot(workday, document, extraction, []);
    expect(shot?.html).not.toContain('>否<');
    expect(shot?.html).not.toContain('1d1eac2e');
    expect(shot?.html).not.toContain('aria-label');
  });
});
