import { cleanLink, companyFromSlug, parsePosting } from '@domain/postings';
import type { Entry, Hint, Posting } from '../../model';
import { clean } from '../../text';
import { attributeValue, isHidden, sleep, textOf, wordsAt } from '../dom';
import { clickLikeAPerson } from '../widgets';
import type { Adapter, CustomField } from './types';

/**
 * Workday names nearly every control with `data-automation-id`, and those names have held steady across tenants.
 * Its forms sit behind a sign-in, so this adapter is written from those conventions and refined from the snapshots
 * the owner saves with "This page didn't fill right". The foot of a step, the progress bar and where an application
 * ends are as its own page code has them (candidate-experience-apply-flow, read 2026-10-08).
 */

const auto = (element: Element | null) => element?.getAttribute('data-automation-id') ?? '';

/**
 * A job's own address on the board, its application included: …/job/Santa-Clara/Engineer_JR123, or …/details/… for
 * the one open beside the list. The board's other pages are no job's: the list itself, the sign-in, the candidate's
 * own home, where an application ends.
 */
const atJob = (url: string) => /\/(job|details)\/[^/]/.test(new URL(url).pathname);

/** An application's pages, under the posting's own address: …/job/Santa-Clara/Engineer_JR123/apply/applyManually. */
const APPLY = /\/job\/.+\/apply(\/[^/]+)?\/?$/;

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
  ethnicityMulti: 'eeo.race',
  veteranStatus: 'eeo.veteran',
  // The disability form (CC-305): its boxes, and the date it's signed on, which Workday takes only as today's.
  disabilityStatus: 'eeo.disability',
  dateSignedOn: 'signatureDate',
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

/**
 * What a field is called: the label or legend of its own wrapper, before any group nearer the control. A date's box
 * is a group itself with no label in it, and a group of boxes sits in a fieldset of its own inside the one that
 * carries the question.
 */
function labelNear(element: Element): string {
  const wrapper =
    element.closest('[data-automation-id^="formField-"]') ?? element.closest('fieldset, [role="group"]');
  const label = wrapper?.querySelector('label, legend');
  return clean(textOf(label).replace(/\*$/, ''));
}

// The star is read from the label's own text: `textOf` takes it off.
const required = (element: Element) => {
  const field = element.closest('[data-automation-id^="formField-"]');
  return (
    Boolean(field?.querySelector('abbr, [class*="required"]')) ||
    /\*\s*$/.test(field?.querySelector('label')?.textContent ?? '')
  );
};

/** Something typed or picked in a section: a date, a job title, a school chosen from a prompt. */
const holdsAnything = (section: Element) =>
  [
    ...section.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]), textarea',
    ),
  ].some((control) => control.value.trim() !== '') ||
  section.querySelector('[data-automation-id="selectedItem"]') !== null;

/**
 * A dropdown shows a choice, not its prompt. Its button carries the chosen option's id as its value, empty while it
 * prompts in whatever language the page is in ("Select One", "选择一个").
 */
export function holdsChoice(button: Element): boolean {
  if (button.hasAttribute('value')) return button.getAttribute('value') !== '';
  return !/select one|^$/i.test(textOf(button));
}

/** The name of a file an upload holds, over its size and its state. */
const FILE_NAME = '[data-automation-id="file-upload-item-name"]';

/**
 * Everything an upload draws for one of its files, from the file's name: the item of its own where the upload lists
 * its files inside its box, else (the resume's field on My Experience, which draws them beside its box) the part of
 * the field round the name that holds no other file, nothing of the box and nothing that names the question.
 */
function fileItem(name: Element): Element {
  const item = name.closest('[data-automation-id="file-upload-item"]');
  if (item) return item;
  let part = name;
  for (
    let up = name.parentElement;
    up &&
    !up.matches('[data-automation-id^="formField-"], fieldset, [role="group"]') &&
    !up.querySelector('input, label, legend') &&
    up.querySelectorAll(FILE_NAME).length === 1;
    up = up.parentElement
  )
    part = up;
  return part;
}

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

  // Only at a job's address: the board's other pages have headings of their own, and the one an application ends
  // on greets the candidate by name ("Welcome, Alex Chen"), which is no posting's title.
  posting(doc, url): Posting | null {
    if (!atJob(url)) return null;
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
        filled: holdsChoice(button),
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
    // Groups of boxes: "choose all that apply", and the disability form's "check one". Where a group takes one
    // answer, the other boxes are disabled while one is ticked: they are its choices all the same.
    for (const group of form.querySelectorAll('[data-automation-id$="-CheckboxGroup"]')) {
      const inputs = [...group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
      if (inputs.length === 0 || isHidden(group)) continue;
      fields.push({
        label: labelNear(group),
        kind: 'multi',
        options: inputs.map((input) =>
          textOf(group.querySelector(`label[for="${attributeValue(input.id)}"]`) ?? input.closest('label')),
        ),
        required: required(group),
        hint: hintOf(group),
        entry: entryOf(group),
        handle: { type: 'multi', inputs },
        anchor: group.closest('[data-automation-id^="formField-"]') ?? group,
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

  // An application is several pages at one address, and not each has something to fill at every moment: a step's
  // fields come a while after its bar and its foot do, and the last step only shows the whole for a look before
  // it's sent. The address tells before anything is drawn, the page itself where the address is another's.
  applying: (doc, url) =>
    APPLY.test(new URL(url).pathname) || doc.querySelector('[data-automation-id="applyFlowPage"]') !== null,

  // What a fill report would keep of the answers, beyond the inputs' own values. A date is shown in a readout over
  // each of its parts and said whole to a screen reader. A ticked box, or a chosen radio, is drawn by an element
  // beside it and by the styles of what's round it, and where a group takes one answer the boxes left over are
  // disabled. All of it goes from every date and every box, answered or not, so that the two read alike. A file an
  // upload holds is named, sized, said to a screen reader ("… successfully uploaded"), marked done and given a
  // button to delete it by name: all of that goes with the file, as an upload holding none draws none of it.
  blank(form) {
    for (const name of form.querySelectorAll(FILE_NAME)) fileItem(name).remove();
    for (const date of form.querySelectorAll('[data-automation-id="dateInputWrapper"]')) {
      for (const readout of date.querySelectorAll('[data-automation-id$="-display"]'))
        readout.textContent = '';
      for (const part of date.querySelectorAll('input')) {
        part.removeAttribute('aria-valuenow');
        part.removeAttribute('aria-valuetext');
      }
      for (const said of date.parentElement?.querySelectorAll('[id^="helpText-"]') ?? [])
        said.textContent = '';
    }
    for (const input of form.querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
      input.removeAttribute('disabled');
      // The box's own wrapper: the input, and the mark drawn for it.
      const box = input.parentElement;
      if (!box || box.querySelectorAll('input, select, textarea, button').length !== 1) continue;
      const label = input.id ? form.querySelector(`label[for="${attributeValue(input.id)}"]`) : null;
      for (const element of [box, ...box.querySelectorAll('*'), ...(label ? [label] : [])])
        element.removeAttribute('class');
      for (const mark of [...box.children].filter((child) => child.tagName === 'DIV')) mark.replaceChildren();
    }
  },

  async prepare(form, counts) {
    let changed = false;
    const sections: [string, number, string][] = [
      ['workExperienceSection', counts.experience, 'workExperience-'],
      ['educationSection', counts.education, 'education-'],
    ];
    for (const [section, wanted, prefix] of sections) {
      const container = form.querySelector(`[data-automation-id="${section}"]`);
      // Entries already filled in ("Autofill with Resume") stay as they are: adding the profile's would repeat them.
      if (!container || holdsAnything(container)) continue;
      for (let attempt = 0; attempt < Math.min(wanted, 6); attempt++) {
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

  // One button at the foot of every step moves the application on, and on the last step it sends it. The last step
  // is the one the progress bar shows no step after. The button's own word for sending is in the page's language
  // ("Submit" in English), so it tells only where no bar is drawn.
  submitButton(doc) {
    const last =
      doc.querySelector('[data-automation-id="progressBarActiveStep"]') !== null &&
      doc.querySelector('[data-automation-id="progressBarInactiveStep"]') === null;
    return (
      [
        ...doc.querySelectorAll<HTMLElement>(
          'button[data-automation-id="bottom-navigation-next-button"], button[data-automation-id="pageFooterNextButton"]',
        ),
      ].find((button) => last || /submit/i.test(textOf(button))) ?? null
    );
  },

  // Once the application is in, someone signed in is taken to a page of their own tasks, at an address that says
  // so: what that page says comes a moment after it loads, in the page's language. Someone applying without an
  // account gets a note on the job board instead, which is told by its words.
  confirmed(doc, url) {
    if (/\/jobTasks\/completed\/application\/?$/.test(new URL(url).pathname)) return true;
    const text = wordsAt(
      doc,
      ['[data-automation-id="applicationSubmittedDialog"]', '[role="dialog"]', 'main', 'body'],
      4000,
    );
    return /application (was |has been )?(successfully )?submitted|thank you for applying|congratulations/i.test(
      text,
    );
  },
};
