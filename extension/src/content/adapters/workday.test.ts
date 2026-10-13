import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FrameScan, Want } from '../../model';
import { planForm } from '../../plan';
import { pickOption } from '../../rules/options';
import { makeProfile } from '../../test/profiles';
import { applyAnswer, readAnswer } from '../apply';
import { extractFields } from '../extract';
import { startContent } from '../main';
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

// From the owner's reports of 2026-10-09 (values stripped), Palo Alto Networks' Voluntary Disclosures and Self
// Identify steps: a group of boxes is a fieldset of its own, drawn row by row, inside the fieldset whose legend asks
// the question; a date is three number boxes in a group of their own, under a legend too.
const boxes = (name: string, choices: [id: string, label: string][]) => `
  <div><div><span data-automation-id="223135091-rows_${choices.length}">
    <fieldset data-automation-id="${name}-CheckboxGroup" id="form--${name}" aria-required="true">
      <div><div aria-label="grid" aria-readonly="true" class="ReactVirtualized__Grid ReactVirtualized__List" role="grid" tabindex="0">
        <div class="ReactVirtualized__Grid__innerScrollContainer" role="row">${choices
          .map(
            ([id, label]) => `
          <div role="row"><div role="cell"><div class="css-1utp272">
            <div class="css-d3pjdr"><input id="${id}-${name}" type="checkbox" aria-checked="false" aria-required="true" class="css-12iq04x"><span class="css-15ws53q"></span><div class="css-1ikf28c"><div class="css-wwg2k6"></div></div></div>
            <label cursor="pointer" for="${id}-${name}" class="css-1ew7hmu">${label}</label>
          </div></div></div>`,
          )
          .join('')}
        </div>
      </div></div>
    </fieldset>
  </span></div></div>`;
const asked = (id: string, question: string) =>
  `<legend><label id="${id}"><span>${question}<abbr aria-hidden="true">*</abbr></span></label></legend>`;
const US = '(United States of America)';

const VOLUNTARY = `
<div data-automation-id="applyFlowPage">
  <h3 tabindex="-1">Voluntary Disclosures</h3>
  <div data-automation-id="applyFlowVoluntaryDisclosuresPage"><div role="group" aria-labelledby="personalInfoUS-section">
    <div data-fkit-id="personalInfoUS--null">
      <div data-automation-id="formField-gender" data-fkit-id="personalInfoUS--gender">
        <label for="personalInfoUS--gender"><span>Please indicate your gender.<abbr aria-hidden="true">*</abbr></span></label>
        <div><button aria-haspopup="listbox" type="button" value="" name="gender" id="personalInfoUS--gender"></button></div>
      </div>
      <div data-automation-id="formField-ethnicityMulti" data-fkit-id="personalInfoUS--ethnicityMulti">
        <fieldset>
          ${asked('label383', 'Please indicate your race / ethnic group (choose all that apply).')}
          ${boxes('ethnicityMulti', [
            [
              '5aa443c785ff104457aecf7432eb0315',
              `American Indian or Alaska Native (Not Hispanic or Latino) ${US}`,
            ],
            ['5aa443c785ff104457aead1ce4b30300', `Asian (Not Hispanic or Latino) ${US}`],
            ['5aa443c785ff104457aec7dd77130310', `Black or African American (Not Hispanic or Latino) ${US}`],
            ['5aa443c785ff104457aec938677b0311', `Hispanic or Latino ${US}`],
            [
              '5aa443c785ff104457aecaeed1db0312',
              `Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino) ${US}`,
            ],
            ['5aa443c785ff104457aecc4fa6130313', `Two or More Races (Not Hispanic or Latino) ${US}`],
            ['5aa443c785ff104457aecdaca9bb0314', `White (Not Hispanic or Latino) ${US}`],
            ['5aa443c785ff104457aff6ba35e30360', `Wish Not To Answer ${US}`],
          ])}
        </fieldset>
      </div>
      <div data-automation-id="formField-hispanicOrLatino" data-fkit-id="personalInfoUS--hispanicOrLatino">
        <label for="personalInfoUS--hispanicOrLatino"><span>Are you hispanic or Latino descent?<abbr aria-hidden="true">*</abbr></span></label>
        <div><button aria-haspopup="listbox" type="button" value="" name="hispanicOrLatino" id="personalInfoUS--hispanicOrLatino"></button></div>
      </div>
    </div>
  </div></div>
</div>`;

const SELF_IDENTIFY = `
<div data-automation-id="applyFlowPage">
  <h3 tabindex="-1">Self Identify</h3>
  <div data-automation-id="applyFlowSelfIdentifyPage"><div role="group" aria-labelledby="selfIdentifiedDisabilityData-section">
    <div data-fkit-id="selfIdentifiedDisabilityData--null"><div lang="en-US">
      <h3>Voluntary Self-Identification of Disability</h3>
      <div data-automation-id="formField-name" data-fkit-id="selfIdentifiedDisabilityData--name">
        <label for="selfIdentifiedDisabilityData--name"><span>Name<abbr aria-hidden="true">*</abbr></span></label>
        <div><input type="text" id="selfIdentifiedDisabilityData--name" name="name" aria-required="true"></div>
      </div>
      <div data-automation-id="formField-dateSignedOn" data-fkit-id="selfIdentifiedDisabilityData--dateSignedOn">
        <fieldset>
          ${asked('label423', 'Date')}
          <div><div>
            <div aria-hidden="true" id="helpText-selfIdentifiedDisabilityData--dateSignedOn">current value is MM/DD/YYYY</div>
            <div id="selfIdentifiedDisabilityData--dateSignedOn" aria-labelledby="hiddenDateValueId-selfIdentifiedDisabilityData--dateSignedOn" role="group" data-automation-id="dateInputWrapper">
              <div tabindex="-1">${[
                ['Month', 'MM', 12],
                ['Day', 'DD', 31],
                ['Year', 'YYYY', 9999],
              ]
                .map(
                  ([part, shown, most]) => `
                <div id="selfIdentifiedDisabilityData--dateSignedOn-dateSection${part}" tabindex="-1">
                  <div aria-hidden="true" data-automation-id="dateSection${part}-display">${shown}</div>
                  <input role="spinbutton" aria-label="${part}" aria-valuemax="${most}" aria-valuemin="1" aria-valuetext="${shown}"
                    id="selfIdentifiedDisabilityData--dateSignedOn-dateSection${part}-input" data-automation-id="dateSection${part}-input">
                </div>`,
                )
                .join('<div>/</div>')}
              </div>
              <div aria-label="Calendar" data-automation-id="dateIcon" role="button" tabindex="0"></div>
            </div>
          </div></div>
        </fieldset>
      </div>
      <div data-automation-id="formField-disabilityStatus" data-fkit-id="selfIdentifiedDisabilityData--disabilityStatus">
        <fieldset>
          ${asked('label424', 'Please check one of the boxes below:')}
          ${boxes('disabilityStatus', [
            ['64cbff5f364f10000ae7a421cf210000', 'Yes, I have a disability, or have had one in the past'],
            [
              '64cbff5f364f10000aeec521b4ec0000',
              'No, I do not have a disability and have not had one in the past',
            ],
            ['64cbff5f364f10000af3af293a050000', 'I do not want to answer'],
          ])}
        </fieldset>
      </div>
    </div></div>
  </div></div>
</div>`;

describe('workday’s voluntary questions, from the owner’s reports', () => {
  const ctx = {
    profile: makeProfile(),
    email: 'alex@example.com',
    resumeId: null,
    posting: null,
    today: '2026-10-09',
    appliedBefore: false,
  };
  const noFile = async () => null;
  const read = (page: string) => {
    document.body.innerHTML = page;
    const extraction = extractFields(workday, document, 0);
    const byHint = (hint: string) => extraction.fields.find((field) => field.hint === hint)!;
    return { ...extraction, byHint };
  };
  const ticked = () =>
    [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .filter((input) => input.checked)
      .map((input) => document.querySelector(`label[for="${input.id}"]`)?.textContent);
  /** As Workday's page does where a group takes one answer: while a box is ticked, the others can't be pressed. */
  const oneAnswerOnly = () => {
    const group = [...document.querySelectorAll<HTMLInputElement>('input[id$="-disabilityStatus"]')];
    for (const input of group)
      input.addEventListener('change', () => {
        for (const other of group) other.disabled = group.some((one) => one.checked) && !other.checked;
      });
  };

  it('names a group of boxes and a date by the question over them, whatever is nearer', () => {
    const race = read(VOLUNTARY).byHint('eeo.race');
    expect(race).toMatchObject({
      label: 'Please indicate your race / ethnic group (choose all that apply).',
      kind: 'multi',
      required: true,
      filled: false,
    });
    expect(race.options).toHaveLength(8);
    expect(race.options[1]).toBe(`Asian (Not Hispanic or Latino) ${US}`);

    const { fields, byHint } = read(SELF_IDENTIFY);
    expect(byHint('eeo.disability')).toMatchObject({
      label: 'Please check one of the boxes below:',
      kind: 'multi',
      required: true,
      options: [
        'Yes, I have a disability, or have had one in the past',
        'No, I do not have a disability and have not had one in the past',
        'I do not want to answer',
      ],
    });
    expect(byHint('signatureDate')).toMatchObject({ label: 'Date', kind: 'date', required: true });
    // Each box belongs to its group, and each part of the date to the date: none is a field of its own.
    expect(fields.map((field) => field.label)).toEqual([
      'Please check one of the boxes below:',
      'Date',
      'Name',
    ]);
  });

  it('answers them from the profile, and dates the form today', () => {
    const profile = makeProfile({ eeo: { race: 'asian', disability: 'no' } });
    const answers = (page: string, who = profile) => {
      const { fields } = read(page);
      const plan = planForm(fields, { ...ctx, profile: who }, []);
      return Object.fromEntries(
        fields.map((field, at) => {
          const { status, answer } = plan[at]!;
          const put = answer?.type === 'choice' ? answer.option : answer?.type === 'date' ? answer.iso : null;
          return [field.hint ?? field.label, [status, put]];
        }),
      );
    };
    expect(answers(VOLUNTARY)['eeo.race']).toEqual(['filled', `Asian (Not Hispanic or Latino) ${US}`]);
    expect(answers(SELF_IDENTIFY)).toMatchObject({
      'eeo.disability': ['filled', 'No, I do not have a disability and have not had one in the past'],
      signatureDate: ['filled', '2026-10-09'],
    });
    // Someone who'd rather not say gets each form's own words for that.
    expect(answers(VOLUNTARY, ctx.profile)['eeo.race']).toEqual(['filled', `Wish Not To Answer ${US}`]);
    expect(answers(SELF_IDENTIFY, ctx.profile)['eeo.disability']).toEqual([
      'filled',
      'I do not want to answer',
    ]);
  });

  it('dates the form today in whatever language the page words the question', () => {
    const { fields } = read(SELF_IDENTIFY.replace('<span>Date<abbr', '<span>Fecha<abbr'));
    const date = fields.find((field) => field.kind === 'date')!;
    expect(date.label).toBe('Fecha');
    expect(planForm([date], ctx, [])[0]).toMatchObject({
      key: 'signatureDate',
      answer: { type: 'date', iso: '2026-10-09' },
    });
  });

  it('ticks the one box of a group, and leaves the others', async () => {
    const { fields, handles, byHint } = read(VOLUNTARY);
    const profile = makeProfile({ eeo: { race: 'two-or-more' } });
    const race = byHint('eeo.race');
    const answer = planForm(fields, { ...ctx, profile }, []).find(
      (entry) => entry.fieldId === race.id,
    )!.answer!;
    expect(await applyAnswer(handles.get(race.id)!, answer, noFile)).toEqual({
      ok: true,
      value: `Two or More Races (Not Hispanic or Latino) ${US}`,
    });
    expect(ticked()).toEqual([`Two or More Races (Not Hispanic or Latino) ${US}`]);
    expect(
      extractFields(workday, document, 0).fields.find((field) => field.hint === 'eeo.race'),
    ).toMatchObject({
      filled: true,
    });
  });

  it('keeps the boxes Workday shuts while one is ticked among the question’s choices', () => {
    const before = read(SELF_IDENTIFY).byHint('eeo.disability');
    oneAnswerOnly();
    document.querySelector<HTMLInputElement>('[id$="aeec521b4ec0000-disabilityStatus"]')!.click();
    expect(document.querySelectorAll('input[type="checkbox"]:disabled')).toHaveLength(2);
    const after = extractFields(workday, document, 0).fields.find((field) => field.hint === 'eeo.disability');
    expect(after).toMatchObject({
      kind: 'multi',
      filled: true,
      label: before.label,
      options: before.options,
    });
  });

  it('moves a tick of its own: the old one off before the new one on', async () => {
    const { handles, byHint } = read(SELF_IDENTIFY);
    oneAnswerOnly();
    const handle = handles.get(byHint('eeo.disability').id)!;
    const want = (value: string) =>
      ({ type: 'choice', want: { kind: 'eeo', field: 'disability', value }, option: null }) as const;
    await applyAnswer(handle, want('no'), noFile);
    expect(ticked()).toEqual(['No, I do not have a disability and have not had one in the past']);
    // "Yes" stands before "No", and can't be pressed while "No" is ticked.
    expect(await applyAnswer(handle, want('yes'), noFile)).toMatchObject({ ok: true });
    expect(ticked()).toEqual(['Yes, I have a disability, or have had one in the past']);
  });

  it('says so when the box it wants can’t be ticked', async () => {
    const { handles, byHint } = read(SELF_IDENTIFY);
    const handle = handles.get(byHint('eeo.disability').id)!;
    // Shut for a reason that unticking the others doesn't lift.
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      input.disabled = true;
    const answer = { type: 'choice', want: { kind: 'decline' }, option: 'I do not want to answer' } as const;
    expect(await applyAnswer(handle, answer, noFile)).toMatchObject({ ok: false });
    expect(ticked()).toEqual([]);
  });

  it('writes a date into its three parts, and leaves the field: the form takes a date only then', async () => {
    const { handles, byHint } = read(SELF_IDENTIFY);
    const part = (name: string) =>
      document.querySelector<HTMLInputElement>(`[data-automation-id="dateSection${name}-input"]`)!;
    let left = 0;
    document
      .querySelector('[data-automation-id="dateInputWrapper"]')!
      .addEventListener('focusout', (event) => {
        const next = (event as FocusEvent).relatedTarget ?? document.activeElement;
        if (!(next instanceof Node && (event.currentTarget as Element).contains(next))) left++;
      });
    const result = await applyAnswer(
      handles.get(byHint('signatureDate').id)!,
      { type: 'date', iso: '2026-10-09' },
      noFile,
    );
    expect(result).toEqual({ ok: true, value: '10/09/2026' });
    expect([part('Month').value, part('Day').value, part('Year').value]).toEqual(['10', '09', '2026']);
    expect(left).toBe(1);
    expect(document.activeElement).toBe(document.body);
  });
});

describe('a report of a Workday page', () => {
  const report = () => formSnapshot(workday, document, extractFields(workday, document, 0), [])!.html;

  it('keeps no answer of a group of boxes or of a date: answered, the page reads as it does unanswered', () => {
    document.body.innerHTML = SELF_IDENTIFY;
    const unanswered = report();

    // The same page as Workday draws it once "No" is ticked and the form dated: the mark in the ticked box, the
    // other boxes shut and greyed, the date in the readouts and in what a screen reader is told.
    document.body.innerHTML = SELF_IDENTIFY;
    const [yes, no, rather] = [
      ...document.querySelectorAll<HTMLInputElement>('input[id$="-disabilityStatus"]'),
    ];
    no!.checked = true;
    no!.setAttribute('aria-checked', 'true');
    no!.nextElementSibling!.nextElementSibling!.innerHTML =
      '<div class="css-1lijdsm"><span class="css-1kdudgw"></span></div>';
    for (const shut of [yes!, rather!]) {
      shut.disabled = true;
      shut.parentElement!.className = 'css-1b7l3y9';
      document.querySelector(`label[for="${shut.id}"]`)!.className = 'css-zs5a3q';
    }
    for (const [part, value] of [
      ['Month', '10'],
      ['Day', '09'],
      ['Year', '2026'],
    ]) {
      document.querySelector(`[data-automation-id="dateSection${part}-display"]`)!.textContent = value!;
      const input = document.querySelector<HTMLInputElement>(
        `[data-automation-id="dateSection${part}-input"]`,
      )!;
      input.value = String(Number(value));
      input.setAttribute('aria-valuenow', String(Number(value)));
      input.setAttribute('aria-valuetext', String(Number(value)));
    }
    document.querySelector('[id^="helpText-"]')!.textContent = 'current value is 10/09/2026';

    const answered = report();
    expect(answered).toBe(unanswered);
    expect(answered).not.toMatch(/2026|css-1lijdsm|disabled/);
    // The page's structure is all still there to read a field from.
    document.body.innerHTML = answered;
    expect(extractFields(workday, document, 0).fields.map((field) => [field.label, field.kind])).toEqual([
      ['Please check one of the boxes below:', 'multi'],
      ['Date', 'date'],
      ['Name', 'text'],
    ]);
  });
});

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

const EMAIL =
  '<div data-automation-id="formField-email"><label for="email">Email Address*</label><input id="email" data-automation-id="email"></div>';

// The last things of a step as Workday's own page code draws them (read 2026-10-08): the progress bar with a step
// for each page of the application, and at the foot one button that moves it on, worded in the page's language.
// Between them, what the step holds: fields, as a rule.
const step = (bar: ('Completed' | 'Active' | 'Inactive')[], next: string, holds = EMAIL) => `
<div data-automation-id="applyFlowPage">
  ${
    bar.length
      ? `<div data-automation-id="progressBar">${bar
          .map((kind) => `<div data-automation-id="progressBar${kind}Step"><label>A step</label></div>`)
          .join('')}</div>`
      : ''
  }
  ${holds}
  <div data-automation-id="pageFooter">
    <button data-automation-id="pageFooterBackButton">Back</button>
    <button data-automation-id="pageFooterNextButton">${next}</button>
  </div>
</div>`;

describe('sending a Workday application', () => {
  const sends = (bar: Parameters<typeof step>[0], next: string) => {
    document.body.innerHTML = step(bar, next);
    return workday.submitButton(document);
  };
  const button = () => document.querySelector('[data-automation-id="pageFooterNextButton"]');

  it('is the press of the button at the foot of the last step, whatever language it is worded in', () => {
    for (const word of ['Submit', '提交', 'Envoyer']) {
      expect(sends(['Completed', 'Completed', 'Active'], word), word).toBe(button());
    }
    // An application of one step.
    expect(sends(['Active'], '提交')).toBe(button());
  });

  it('is no press of it while a step is left', () => {
    for (const word of ['Save and Continue', '保存并继续', 'Next']) {
      expect(sends(['Completed', 'Active', 'Inactive'], word), word).toBeNull();
    }
  });

  it('is told by the button’s word where no progress bar is drawn', () => {
    expect(sends([], 'Submit')).toBe(button());
    expect(sends([], 'Save and Continue')).toBeNull();
  });
});

describe('a Workday application that went through', () => {
  const site = 'https://acme.wd1.myworkdayjobs.com/en-US/Careers';

  it('is told by the address someone signed in is taken to, before that page has drawn a word', () => {
    document.body.innerHTML = '<div id="root"></div>';
    expect(workday.confirmed(document, `${site}/jobTasks/completed/application`)).toBe(true);
    expect(workday.confirmed(document, `${site}/jobTasks/completed/application/?source=LinkedIn`)).toBe(true);
  });

  it('is none at the other addresses of a job board', () => {
    document.body.innerHTML = '<div id="root"></div>';
    for (const path of [
      '',
      '/userHome',
      '/jobTasks/completed/questionnaire',
      '/job/Santa-Clara/Software-Engineer_JR123',
      '/job/Santa-Clara/Software-Engineer_JR123/apply/applyManually',
    ]) {
      expect(workday.confirmed(document, `${site}${path}`), path).toBe(false);
    }
  });

  it('is told by the words of the note someone applying without an account gets', () => {
    document.body.innerHTML =
      '<div id="root"><h2>Search for Jobs</h2></div>' +
      '<div role="dialog"><h2>Congratulations!</h2><p>Your application has successfully been submitted.</p></div>';
    expect(workday.confirmed(document, `${site}?Job_Application_ID=abc123`)).toBe(true);
    document.body.innerHTML = step(['Completed', 'Active'], 'Submit');
    expect(workday.confirmed(document, `${site}/job/Santa-Clara/Software-Engineer_JR123/apply`)).toBe(false);
  });
});

describe('the pages of a Workday board', () => {
  const board = 'https://acme.wd5.myworkdayjobs.com/en-US/External';
  const job = `${board}/job/San-Jose-CA/Software-Engineer_R123`;
  const apply = `${job}/apply/applyManually`;
  // Where someone signed in is taken once an application is in: their own home on the board, which greets them by
  // name in a heading (an owner's screen, 2026-10-12).
  const HOME =
    '<div id="root"><h2 data-automation-id="pageHeader">Welcome, Alex Chen</h2><h3>My Tasks</h3></div>';
  const page = (html: string) => {
    const doc = document.implementation.createHTMLDocument('');
    doc.body.innerHTML = html;
    return doc;
  };

  it('are a posting’s at a job’s address only, whatever heading the others carry', () => {
    expect(workday.posting(page(HOME), `${board}/jobTasks/completed/application`)).toBeNull();
    expect(workday.posting(page(HOME), `${board}/userHome`)).toBeNull();
    expect(
      workday.posting(page('<h2 data-automation-id="pageHeader">Search for Jobs</h2>'), board),
    ).toBeNull();

    const posting = page('<h2 data-automation-id="jobPostingHeader">Software Engineer</h2>');
    expect(workday.posting(posting, job)).toMatchObject({
      company: 'Acme',
      title: 'Software Engineer',
      url: job,
    });
    // The one open beside the list of jobs.
    expect(workday.posting(posting, `${board}/details/Software-Engineer_R123`)).toMatchObject({
      title: 'Software Engineer',
    });
    // Its application's pages are the posting's still, at its address.
    const applying = page('<h2 data-automation-id="jobTitleHeading">Software Engineer</h2>');
    expect(workday.posting(applying, apply)).toMatchObject({ title: 'Software Engineer', url: job });
  });

  it('are an application’s by their address, before anything of it is drawn, or by what is drawn', () => {
    const bare = page('<div id="root"></div>');
    for (const path of ['/apply', '/apply/applyManually', '/apply/autofillWithResume', '/apply/'])
      expect(workday.applying?.(bare, `${job}${path}`), path).toBe(true);
    for (const url of [job, board, `${board}/userHome`, `${board}/jobTasks/completed/application`])
      expect(workday.applying?.(bare, url), url).toBe(false);
    // An agency's update of an application is its pages at an address of the candidate's tasks.
    const drawn = page(step(['Active', 'Inactive'], 'Next'));
    expect(workday.applying?.(drawn, `${board}/jobTasks/updateAgencyApplication/1/2/3`)).toBe(true);
  });

  describe('as the content script reads them', () => {
    const { happyDOM } = window as unknown as { happyDOM: { setURL(url: string): void } };
    const first = location.href;
    type Listener = (message: object, sender: object, respond: (value: unknown) => void) => boolean;
    let stop = () => {};

    afterEach(() => {
      stop();
      vi.restoreAllMocks();
      happyDOM.setURL(first);
    });

    /** What the script answers the service worker's reading of the page at this address. */
    function read(url: string, html: string): Promise<FrameScan> {
      stop();
      happyDOM.setURL(url);
      document.body.innerHTML = html;
      let listener: Listener | undefined;
      vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener').mockImplementation(((fn: Listener) => {
        listener = fn;
      }) as never);
      vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async () => undefined) as never);
      stop = startContent();
      return new Promise<FrameScan>((resolve) =>
        listener!({ type: 'frame:scan', frameId: 0, prepare: null }, {}, (scan) =>
          resolve(scan as FrameScan),
        ),
      );
    }

    // What a step shows in place of its fields while they are on their way, and what the last one shows: the whole
    // application to read over (candidate-experience-apply-flow, read 2026-10-12).
    const LOADING = '<div data-automation-id="applyFlowLoadingPage"><div></div></div>';
    const REVIEW =
      '<div data-automation-id="applyFlowReviewPage"><h4>My Information</h4><div>First Name</div><div>Alex</div></div>';

    it('an application’s step has nothing to fill while its fields are on their way', async () => {
      // Nothing drawn yet: the address is the posting's with the application's own end, and that is all there is.
      expect(await read(apply, '<div id="root"></div>')).toMatchObject({
        isApplication: false,
        applying: true,
        sends: false,
        posting: { url: job },
      });
      const loading = step(['Completed', 'Active', 'Inactive'], 'Save and Continue', LOADING);
      expect(await read(apply, loading)).toMatchObject({
        isApplication: false,
        applying: true,
        sends: false,
      });
      // Once they are there it's a form as any.
      const loaded = step(['Completed', 'Active', 'Inactive'], 'Save and Continue');
      expect(await read(apply, loaded)).toMatchObject({ isApplication: true, applying: true, sends: false });
    });

    it('its last step has nothing to fill at all, and the button that sends it', async () => {
      const review = step(['Completed', 'Completed', 'Active'], 'Submit', REVIEW);
      expect(await read(apply, review)).toMatchObject({
        isApplication: false,
        applying: true,
        sends: true,
        fields: [],
      });
    });

    it('the home it ends on is neither an application’s nor a posting’s', async () => {
      expect(await read(`${board}/jobTasks/completed/application`, HOME)).toMatchObject({
        isApplication: false,
        applying: false,
        posting: null,
      });
    });
  });
});
