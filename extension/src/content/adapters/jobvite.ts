import type { Hint } from '../../model';
import { isHidden, textOf } from '../dom';
import { postingFrom, submittedText } from './shared';
import type { Adapter, CustomField } from './types';

const auto: Record<string, Hint> = {
  'given-name': 'name.first',
  'family-name': 'name.last',
  email: 'email',
  tel: 'phone',
  'address-line1': 'address.line1',
  'address-level2': 'address.city',
  'address-level1': 'address.state',
  'postal-code': 'address.zip',
  'country-name': 'address.country',
};
const application = (doc: Document) =>
  doc.querySelector('form[name="scopeData.applyForm"][ng-submit="submitApplication()"]');
export const jobvite: Adapter = {
  ats: 'jobvite',
  form: application,
  posting(doc, url) {
    const link = new URL(url);
    link.pathname = link.pathname.replace(/\/apply(?:\/.*)?$/, '');
    const result = postingFrom(doc, link.href, 'jobvite', {
      title: '.jv-header h2, .jv-job-detail-title, h2',
      location: '.jv-job-detail-meta, .jv-job-detail-location',
      description: '.jv-job-detail-description',
    });
    return result;
  },
  hint: (control) => auto[control.getAttribute('autocomplete') ?? ''] ?? null,
  skip: (control) => control.matches('textarea[id^="jv-edit-resume"], textarea[id^="jv-paste-resume"]'),
  custom(form) {
    const fields: CustomField[] = [];
    for (const block of form.querySelectorAll('.jv-form-field')) {
      const inputs = [...block.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
      if (inputs.length < 2 || isHidden(block)) continue;
      const labelNode = block.querySelector('.jv-form-field-label, label');
      const label = textOf(labelNode);
      fields.push({
        label,
        kind: 'multi',
        options: inputs.map((input) => textOf(input.closest('label'))),
        required:
          /[*✱]\s*$/.test(labelNode?.textContent ?? '') || block.getAttribute('aria-required') === 'true',
        handle: { type: 'multi', inputs },
        anchor: block,
      });
    }
    // Jobvite appends upload dialogs to <body>. Match the dialog's own document label, not its numeric position.
    const doc = form.ownerDocument;
    for (const dialog of doc.querySelectorAll('.jv-add-attachment[role="dialog"]')) {
      if (!dialog.querySelector('textarea[placeholder*="Resume" i]')) continue;
      const input = dialog.querySelector<HTMLInputElement>('input[type="file"]');
      const anchor = form.querySelector('[jv-add-attachment][attachment-label="Resume"]');
      if (input && anchor)
        fields.push({
          label: 'Resume',
          kind: 'file',
          hint: 'resume',
          options: [],
          required: anchor.getAttribute('aria-required') === 'true',
          handle: { type: 'file', element: input },
          anchor,
        });
    }
    return fields;
  },
  submitButton(doc) {
    return (
      [...(application(doc)?.querySelectorAll<HTMLElement>('button[type="submit"]') ?? [])].find(
        (button) =>
          !isHidden(button) &&
          /send application|submit application/i.test(button.getAttribute('aria-label') ?? textOf(button)),
      ) ?? null
    );
  },
  confirmed: (doc) => submittedText(doc, '.jv-page-confirmation, .jv-wrapper, main'),
};
