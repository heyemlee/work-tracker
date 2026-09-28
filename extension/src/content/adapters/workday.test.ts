import { describe, expect, it } from 'vitest';
import { planForm } from '../../plan';
import { makeProfile } from '../../test/profiles';
import { extractFields } from '../extract';
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
