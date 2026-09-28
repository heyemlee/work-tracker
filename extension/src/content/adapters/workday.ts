import { cleanLink, companyFromSlug, parsePosting } from '@domain/postings';
import type { Entry, Hint, Posting } from '../../model';
import { clean } from '../../text';
import { isHidden, sleep, textOf } from '../dom';
import { clickLikeAPerson } from '../widgets';
import type { Adapter, CustomField } from './types';

/**
 * Workday names nearly every control with `data-automation-id`, and those names have held steady across tenants.
 * Its forms sit behind a sign-in, so this adapter is written from those conventions and refined from the snapshots
 * the owner saves with "This page didn't fill right".
 */

const auto = (element: Element | null) => element?.getAttribute('data-automation-id') ?? '';

const HINTS: Record<string, Hint> = {
  legalNameSection_firstName: 'name.first',
  legalNameSection_lastName: 'name.last',
  preferredNameSection_firstName: 'name.preferred',
  email: 'email',
  'phone-number': 'phone',
  phoneNumber: 'phone',
  'phone-device-type': 'phone.type',
  countryPhoneCode: 'phone.country',
  addressSection_addressLine1: 'address.line1',
  addressSection_city: 'address.city',
  addressSection_countryRegion: 'address.state',
  addressSection_postalCode: 'address.zip',
  countryDropdown: 'address.country',
  country: 'address.country',
  source: 'howHeard',
  sourcePrompt: 'howHeard',
  'file-upload-input-ref': 'resume',
  linkedinQuestion: 'links.linkedin',
  website: 'website',
  gender: 'eeo.gender',
  hispanicOrLatino: 'eeo.hispanic',
  ethnicityDropdown: 'eeo.race',
  ethnicityMultiselect: 'eeo.race',
  veteranStatus: 'eeo.veteran',
};

const ENTRY_HINTS: Record<string, Hint> = {
  jobTitle: 'experience.title',
  company: 'experience.company',
  location: 'experience.location',
  currentlyWorkHere: 'experience.current',
  startDate: 'experience.start',
  endDate: 'experience.end',
  roleDescription: 'experience.description',
  school: 'education.school',
  schoolName: 'education.school',
  degree: 'education.degree',
  fieldOfStudy: 'education.field',
  gpa: 'education.gpa',
  gradeAverage: 'education.gpa',
  firstYearAttended: 'education.start',
  lastYearAttended: 'education.end',
};

/** The id of the control a field wrapper names: "formField-legalNameSection_firstName" → "legalNameSection_firstName". */
const fieldName = (element: Element) => {
  const wrapper = element.closest('[data-automation-id^="formField-"]');
  return wrapper ? auto(wrapper).replace(/^formField-/, '') : auto(element);
};

/** "workExperience-2" → { kind: 'experience', index: 1 }. */
function entryOf(element: Element): Entry | null {
  const panel = element.closest(
    '[data-automation-id^="workExperience-"], [data-automation-id^="education-"], [data-automation-id^="websitePanel"]',
  );
  const match = /^(workExperience|education)-(\d+)$/.exec(auto(panel));
  if (!match) return null;
  return { kind: match[1] === 'workExperience' ? 'experience' : 'education', index: Number(match[2]) - 1 };
}

function hintOf(element: Element): Hint | null {
  const name = fieldName(element);
  if (entryOf(element)) return ENTRY_HINTS[name] ?? ENTRY_HINTS[auto(element)] ?? null;
  return HINTS[name] ?? HINTS[auto(element)] ?? null;
}

function labelNear(element: Element): string {
  const wrapper = element.closest('[data-automation-id^="formField-"], fieldset, [role="group"]');
  const label = wrapper?.querySelector('label, legend');
  return clean(textOf(label).replace(/\*$/, ''));
}

const required = (element: Element) =>
  Boolean(
    element.closest('[data-automation-id^="formField-"]')?.querySelector('abbr, [class*="required"]'),
  ) || /\*\s*$/.test(textOf(element.closest('[data-automation-id^="formField-"]')?.querySelector('label')));

function addButton(section: Element | null): HTMLElement | null {
  if (!section) return null;
  return (
    [...section.querySelectorAll<HTMLElement>('button')].find(
      (button) => /^add( another)?\b/i.test(textOf(button)) || auto(button) === 'Add',
    ) ?? null
  );
}

export const workday: Adapter = {
  ats: 'workday',

  form(doc) {
    const page = doc.querySelector(
      '[data-automation-id="applyFlowPage"], [data-automation-id^="applyFlow"], [data-automation-id="createAccountPage"], [data-automation-id="signInContent"]',
    );
    if (page) return page;
    // Any page with Workday form fields is part of the application.
    return (
      doc.querySelector('[data-automation-id^="formField-"]')?.closest('main, form, [role="main"]') ?? null
    );
  },

  posting(doc, url): Posting {
    const parsed = parsePosting(url);
    const link = new URL(url);
    // The apply flow lives under the posting's own path: …/job/Santa-Clara/Engineer_JR123/apply/…
    link.pathname = link.pathname.replace(/\/apply(\/.*)?$/, '');
    return {
      ats: 'workday',
      title:
        textOf(doc.querySelector('[data-automation-id="jobPostingHeader"], h2[data-automation-id]')) ||
        parsed?.title ||
        null,
      company: parsed?.companySlug ? companyFromSlug(parsed.companySlug, []) : null,
      url: cleanLink(link.toString()) ?? url,
      location:
        textOf(doc.querySelector('[data-automation-id="locations"] dd, [data-automation-id="locations"]')) ||
        null,
      description: textOf(doc.querySelector('[data-automation-id="jobPostingDescription"]')).slice(0, 8000),
    };
  },

  hint: (control) => hintOf(control),

  entry: (control) => entryOf(control),

  skip(control) {
    // Search boxes of multi-select prompts and date parts are custom fields.
    const id = auto(control);
    return (
      /^dateSection(Month|Day|Year)-input$/.test(id) ||
      Boolean(control.closest('[data-automation-id="multiSelectContainer"]'))
    );
  },

  custom(form): CustomField[] {
    const fields: CustomField[] = [];
    // Dropdowns: a button that opens a listbox.
    for (const button of form.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]')) {
      if (isHidden(button)) continue;
      const anchor = button.closest('[data-automation-id^="formField-"]') ?? button;
      fields.push({
        label: labelNear(button) || clean(button.getAttribute('aria-label') ?? ''),
        kind: 'combobox',
        options: [],
        required: required(button),
        hint: hintOf(button),
        entry: entryOf(button),
        handle: { type: 'combobox', element: button },
        anchor,
        filled: !/select one|^$/i.test(textOf(button)),
      });
    }
    // Prompts: type to search, pick from suggestions.
    for (const container of form.querySelectorAll('[data-automation-id="multiSelectContainer"]')) {
      const input = container.querySelector<HTMLInputElement>('input');
      if (!input) continue;
      fields.push({
        label: labelNear(container),
        kind: 'typeahead',
        options: [],
        required: required(container),
        hint: hintOf(container),
        entry: entryOf(container),
        handle: { type: 'prompt', element: input },
        anchor: container.closest('[data-automation-id^="formField-"]') ?? container,
      });
    }
    // Dates typed as month / day / year.
    for (const wrapper of form.querySelectorAll(
      '[data-automation-id="dateInputWrapper"], [data-automation-id^="dateSection"]:not(input)',
    )) {
      const year = wrapper.querySelector<HTMLInputElement>(
        'input[data-automation-id="dateSectionYear-input"]',
      );
      if (!year || fields.some((field) => field.handle.type === 'dateParts' && field.handle.year === year))
        continue;
      fields.push({
        label: labelNear(wrapper),
        kind: 'date',
        options: [],
        required: required(wrapper),
        hint: hintOf(wrapper),
        entry: entryOf(wrapper),
        handle: {
          type: 'dateParts',
          month: wrapper.querySelector<HTMLInputElement>(
            'input[data-automation-id="dateSectionMonth-input"]',
          ),
          day: wrapper.querySelector<HTMLInputElement>('input[data-automation-id="dateSectionDay-input"]'),
          year,
        },
        anchor: wrapper.closest('[data-automation-id^="formField-"]') ?? wrapper,
      });
    }
    return fields;
  },

  step: (doc) => textOf(doc.querySelector('[data-automation-id="progressBarActiveStep"]')) || null,

  async prepare(form, counts) {
    let changed = false;
    const sections: [string, number, string][] = [
      ['workExperienceSection', counts.experience, 'workExperience-'],
      ['educationSection', counts.education, 'education-'],
    ];
    for (const [section, wanted, prefix] of sections) {
      const container = form.querySelector(`[data-automation-id="${section}"]`);
      for (let attempt = 0; container && attempt < Math.min(wanted, 6); attempt++) {
        const have = container.querySelectorAll(`[data-automation-id^="${prefix}"]`).length;
        if (have >= wanted) break;
        const add = addButton(container);
        if (!add) break;
        clickLikeAPerson(add);
        changed = true;
        await sleep(400);
      }
    }
    return changed;
  },

  submitButton: (doc) =>
    [
      ...doc.querySelectorAll<HTMLElement>(
        'button[data-automation-id="bottom-navigation-next-button"], button[data-automation-id="pageFooterNextButton"]',
      ),
    ].find((button) => /submit/i.test(textOf(button))) ?? null,

  confirmed(doc) {
    const text = textOf(
      doc.querySelector('[data-automation-id="applicationSubmittedDialog"], [role="dialog"], main, body'),
    ).slice(0, 4000);
    return /application (was |has been )?(successfully )?submitted|thank you for applying|congratulations/i.test(
      text,
    );
  },
};
