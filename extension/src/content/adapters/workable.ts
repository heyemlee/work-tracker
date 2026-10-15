import type { Hint } from '../../model';
import { isHidden, labelOf } from '../dom';
import { postingFrom, submittedText } from './shared';
import type { Adapter } from './types';

const hints: Record<string, Hint> = {
  firstname: 'name.first',
  lastname: 'name.last',
  email: 'email',
  phone: 'phone',
  address: 'address.line1',
  city: 'address.city',
  postcode: 'address.zip',
  country: 'address.country',
  linkedin: 'links.linkedin',
  website: 'links.website',
};
function form(doc: Document) {
  return (
    [...doc.querySelectorAll('form')].find(
      (node) =>
        !isHidden(node) &&
        !!node.querySelector('#firstname[name="firstname"]') &&
        !!node.querySelector('#lastname[name="lastname"]') &&
        !!node.querySelector('#email[name="email"]'),
    ) ?? null
  );
}
export const workable: Adapter = {
  ats: 'workable',
  form,
  posting(doc, url) {
    const link = new URL(url);
    link.pathname = link.pathname.replace(/\/apply\/?$/, '/');
    return postingFrom(doc, link.href, 'workable', {
      title: '[data-ui="job-title"]',
      company: 'a[data-ui="company-name"]',
      location: '[data-ui="job-location"]',
      description: '[data-ui="job-description"], [aria-labelledby="job-description-title"]',
    });
  },
  hint(control) {
    if (control.matches('input[type="file"]')) {
      const label = labelOf(control);
      return /\bresume\b|\bcv\b/i.test(label) ? 'resume' : /cover letter/i.test(label) ? 'coverLetter' : null;
    }
    return hints[control.getAttribute('name') ?? ''] ?? null;
  },
  // Optional photos are not application documents. Workable's upload IDs are generated anew on each render.
  skip: (control) => control.matches('input[type="file"]') && /^\W*photo\b/i.test(labelOf(control)),
  submitButton: (doc) => form(doc)?.querySelector<HTMLElement>('button[type="submit"]') ?? null,
  confirmed: (doc) => submittedText(doc, '[data-ui="application-success"], main, #app'),
};
