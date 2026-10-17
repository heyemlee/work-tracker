import type { Hint } from '../../model';
import { attributeValue, isHidden, isRequired, labelOf, textOf } from '../dom';
import { postingFrom, submittedText } from './shared';
import type { Adapter, CustomField } from './types';

const hints: Record<string, Hint> = {
  firstname: 'name.first',
  lastname: 'name.last',
  preferredname: 'name.preferred',
  email: 'email',
  emailaddress: 'email',
  phonenumber: 'phone',
  phonetype: 'phone.type',
  phone: 'phone',
  address: 'address.line1',
  address1: 'address.line1',
  addressstreet1: 'address.line1',
  addresscity: 'address.city',
  addressstate: 'address.state',
  addresszip: 'address.zip',
  addresspostalcode: 'address.zip',
  addresscountry: 'address.country',
  linkedin: 'links.linkedin',
  linkedinurl: 'links.linkedin',
  resume: 'resume',
};
function form(doc: Document) {
  // The email-only gate and account/password forms must never be treated as applications.
  return (
    [...doc.querySelectorAll('form')].find(
      (node) =>
        !isHidden(node) &&
        node.id !== 'enterEmailForm' &&
        !node.querySelector('input[type="password"]') &&
        !!node.querySelector(
          '[id*="PersonProfileFields.FirstName"], [name*="PersonProfileFields.FirstName"]',
        ) &&
        !!node.querySelector('[id*="PersonProfileFields.LastName"], [name*="PersonProfileFields.LastName"]'),
    ) ?? screening(doc)
  );
}
function screening(doc: Document) {
  const questions = doc.querySelector('form#questions');
  return questions &&
    !isHidden(questions) &&
    !questions.querySelector('input[type="password"]') &&
    questions.querySelector('select[id^="Q"][name^="Q"]') &&
    [...doc.querySelectorAll('h2,h3')].some((heading) => /^Candidate Questions$/i.test(textOf(heading)))
    ? questions
    : null;
}
function hasLaterStep(doc: Document) {
  const steps = [...doc.querySelectorAll('.iCIMS_Steps li')];
  const current = steps.findIndex((step) => step.classList.contains('iCIMS_Steps_Current'));
  return current >= 0 && current < steps.length - 1;
}
export const icims: Adapter = {
  ats: 'icims',
  form,
  posting(doc, url) {
    const link = new URL(url);
    link.search = '';
    link.hash = '';
    link.pathname = link.pathname.replace(/\/(?:login|profile|apply|candidate|questions)\/?$/, '/job');
    const result = postingFrom(doc, link.href, 'icims', {
      title: 'h1.iCIMS_Header, .iCIMS_JobTitle',
      company: '.iCIMS_CompanyName',
      location: '.iCIMS_JobHeaderGroup .iCIMS_JobHeaderData',
      description: '.iCIMS_InfoMsg.iCIMS_InfoField_Job, .iCIMS_JobContent',
    });
    const path = /^(\/jobs\/\d+\/(?:[^/]+\/)?)(?:job|login|profile|apply|candidate|questions)\/?$/.exec(
      link.pathname,
    );
    // Candidate/login URLs can carry access codes. A tracked link must point back to the public posting.
    return { ...result, url: path ? `${link.origin}${path[1]}job` : link.href };
  },
  hint(control) {
    const key = /PersonProfileFields\.(.+)/i
      .exec(control.id || control.getAttribute('name') || '')?.[1]
      ?.replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
    if (key) return hints[key.replace(/^emailfieldset/, '')] ?? hints[key] ?? null;
    if (control.matches('input[type="file"]') && /resume|\bcv\b/i.test(labelOf(control))) return 'resume';
    return null;
  },
  custom(root) {
    const fields: CustomField[] = [];
    for (const select of root.querySelectorAll<HTMLSelectElement>('select[id]')) {
      const anchor = root.querySelector<HTMLElement>(`[id="${attributeValue(select.id)}_icimsDropdown"]`);
      if (
        !anchor ||
        isHidden(anchor) ||
        select.disabled ||
        select.matches(':disabled') ||
        anchor.getAttribute('aria-disabled') === 'true'
      )
        continue;
      const label = labelOf(anchor) || labelOf(select);
      fields.push({
        label,
        kind: 'combobox',
        // The real widget may keep only the current option in its hidden select. The menu loads on open.
        options: [...select.options]
          .filter(
            (option) =>
              option.value &&
              !option.disabled &&
              !(option.selected && anchor.querySelector('.dropdown-placeholder')),
          )
          .map((option) => option.text.trim()),
        required: isRequired(select, label) || isRequired(anchor, label),
        hint: icims.hint?.(select),
        handle: {
          type: 'combobox',
          element: anchor,
          // "Please select a country" is a nonempty native value but a placeholder in the visible widget.
          shown: () =>
            anchor.querySelector('.dropdown-placeholder')
              ? null
              : select.value
                ? textOf(select.selectedOptions[0]) || null
                : null,
        },
        anchor,
      });
    }
    return fields;
  },
  applying(doc, url) {
    // Registration/profile setup is part of applying, but a password-bearing form stays unfillable.
    return (
      !!form(doc) ||
      (!!doc.querySelector('form#profileForm [id="PersonProfileFields.FirstName"]') &&
        !!doc.querySelector('form#profileForm [id="PersonProfileFields.LastName"]')) ||
      /^\/jobs\/\d+\/(?:[^/]+\/)?(?:candidate|questions)\/?$/.test(new URL(url).pathname)
    );
  },
  // A profile's Save/Continue advances a step; only the final application action is watched as submission.
  submitButton(doc) {
    // This tenant labels Candidate Questions "Submit" even while its progress list still has EEO ahead.
    if (hasLaterStep(doc)) return null;
    const questions = screening(doc);
    if (questions) {
      const submit = questions.querySelector<HTMLInputElement>('input[type="submit"]#quesp_form_submit_i');
      return submit && !submit.disabled && !isHidden(submit) && /^Submit$/i.test(submit.value)
        ? submit
        : null;
    }
    return (
      [...(form(doc)?.querySelectorAll<HTMLElement>('button, input[type="submit"]') ?? [])].find(
        (button) =>
          !isHidden(button) &&
          /^(?:submit|send)(?: my)? application$/i.test(
            button instanceof HTMLInputElement ? button.value : textOf(button),
          ),
      ) ?? null
    );
  },
  isSubmission: (doc, submitter) => submitter !== null && icims.submitButton(doc) === submitter,
  step: (doc) =>
    screening(doc)
      ? 'Candidate questions'
      : doc.querySelector('form#profileForm')
        ? 'Candidate profile'
        : null,
  confirmed: (doc) => submittedText(doc, '.iCIMS_ApplicationComplete, .iCIMS_Confirmation'),
  blank(root) {
    // The dropdown displays a selected answer outside the hidden native select.
    for (const dropdown of root.querySelectorAll('[id$="_icimsDropdown"]')) {
      dropdown.textContent = '';
      dropdown.removeAttribute('title');
      dropdown.removeAttribute('aria-valuetext');
    }
    // Candidate forms can carry access codes in navigation URLs as well as hidden inputs.
    root.removeAttribute('action');
    for (const element of root.querySelectorAll('[href], [action], [formaction]')) {
      for (const attr of ['href', 'action', 'formaction']) element.removeAttribute(attr);
    }
  },
};
