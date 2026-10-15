import type { Hint } from '../../model';
import { attributeValue, isHidden, labelOf, textOf } from '../dom';
import { postingFrom, submittedText } from './shared';
import type { Adapter, CustomField } from './types';

const hints: Record<string, Hint> = {
  firstname: 'name.first',
  lastname: 'name.last',
  preferredname: 'name.preferred',
  email: 'email',
  emailaddress: 'email',
  phonenumber: 'phone',
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
    ) ?? null
  );
}
export const icims: Adapter = {
  ats: 'icims',
  form,
  posting(doc, url) {
    const link = new URL(url);
    link.search = '';
    link.pathname = link.pathname.replace(/\/(?:login|profile|apply)\/?$/, '/job');
    const result = postingFrom(doc, link.href, 'icims', {
      title: 'h1.iCIMS_Header, .iCIMS_JobTitle',
      company: '.iCIMS_CompanyName',
      location: '.iCIMS_JobHeaderGroup .iCIMS_JobHeaderData',
      description: '.iCIMS_InfoMsg.iCIMS_InfoField_Job, .iCIMS_JobContent',
    });
    const path = /^(\/jobs\/\d+\/(?:[^/]+\/)?)(?:job|login|profile|apply)\/?$/.exec(link.pathname);
    // Candidate/login URLs can carry access codes. A tracked link must point back to the public posting.
    return { ...result, url: path ? `${link.origin}${path[1]}job` : link.href };
  },
  hint(control) {
    const key = /PersonProfileFields\.(.+)/i
      .exec(control.id || control.getAttribute('name') || '')?.[1]
      ?.replace(/[^a-z]/gi, '')
      .toLowerCase();
    if (key) return hints[key.replace(/^emailfieldset/, '')] ?? hints[key] ?? null;
    if (control.matches('input[type="file"]') && /resume|\bcv\b/i.test(labelOf(control))) return 'resume';
    return null;
  },
  custom(root) {
    const fields: CustomField[] = [];
    for (const select of root.querySelectorAll<HTMLSelectElement>('select[id]')) {
      const anchor = root.querySelector<HTMLElement>(`[id="${attributeValue(select.id)}_icimsDropdown"]`);
      if (!anchor || isHidden(anchor)) continue;
      fields.push({
        label: labelOf(anchor) || labelOf(select),
        kind: 'combobox',
        options: [...select.options].filter((option) => option.value).map((option) => option.text.trim()),
        required: select.required || select.getAttribute('aria-required') === 'true',
        hint: icims.hint?.(select),
        handle: {
          type: 'combobox',
          element: anchor,
          shown: () => (select.value ? textOf(select.selectedOptions[0]) || null : null),
        },
        anchor,
      });
    }
    return fields;
  },
  // A profile's Save/Continue advances a step; only the final application action is watched as submission.
  submitButton(doc) {
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
  confirmed: (doc) => submittedText(doc, '.iCIMS_ApplicationComplete, .iCIMS_Confirmation'),
};
