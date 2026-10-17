import { cleanLink } from '@domain/postings';
import type { Entry, Hint } from '../../model';
import { jsonAfter, textOf, waitFor } from '../dom';
import { clickLikeAPerson } from '../widgets';
import { componentHidden, optionText, postingFrom, shadowElements, shadowOptions } from './shared';
import type { Adapter, CustomField } from './types';

const form = (doc: Document) => doc.querySelector('oc-oneclick-form');
const hints: Record<string, Hint> = {
  'first-name-input': 'name.first',
  'last-name-input': 'name.last',
  'email-input': 'email',
  'confirm-email-input': 'email',
  'linkedin-input': 'links.linkedin',
  'website-input': 'links.website',
  'twitter-input': 'links.twitter',
};
const label = (host: Element) =>
  host.getAttribute('label') ||
  host.getAttribute('splarialabel') ||
  host.getAttribute('aria-label') ||
  textOf(host.querySelector('[slot="label-content"], [slot="label"]')) ||
  textOf(host);
const required = (host: Element) =>
  host.hasAttribute('required') ||
  host.getAttribute('aria-required') === 'true' ||
  shadowElements(host, 'input[aria-required="true"], textarea[aria-required="true"]').length > 0;
const componentText = (host: Element) =>
  textOf(host) || shadowElements(host, 'button, span').map(textOf).filter(Boolean).join(' ');

function across(element: Element, selector: string): Element | null {
  let current: Element | null = element;
  while (current) {
    const found = current.closest(selector);
    if (found) return found;
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}
function entryOf(host: Element): Entry | null {
  const entry = across(host, 'oc-experience-entry, oc-education-entry');
  if (!entry) return null;
  const kind = entry.tagName === 'OC-EXPERIENCE-ENTRY' ? 'experience' : 'education';
  const section = entry.closest(`oc-${kind}`);
  const index = section ? [...section.querySelectorAll(`oc-${kind}-entry`)].indexOf(entry) : -1;
  return index < 0 ? null : { kind, index };
}
function entryHint(host: Element): Hint | null {
  const entry = entryOf(host);
  if (!entry) return null;
  const data = across(host, '[data-test]')?.getAttribute('data-test');
  const map: Record<string, Hint> = {
    'job-title-autocomplete': 'experience.title',
    'company-autocomplete': 'experience.company',
    'experience-description': 'experience.description',
    'experience-date-from': 'experience.start',
    'experience-date-to': 'experience.end',
    'experience-current': 'experience.current',
    'institution-autocomplete': 'education.school',
    'education-major': 'education.field',
    'education-degree': 'education.degree',
    'education-date-from': 'education.start',
    'education-date-to': 'education.end',
  };
  // A widget often has an empty data-test of its own; the Angular wrapper supplies the stable contract.
  let current: Element | null = host;
  while (current && !current.matches('oc-experience-entry, oc-education-entry')) {
    const test = current.getAttribute('data-test');
    if (test && map[test]) return map[test];
    if (test === 'location-autocomplete') return entry.kind === 'experience' ? 'experience.location' : null;
    current = current.parentElement;
  }
  return data ? (map[data] ?? null) : null;
}

/** OneClick uses Lit components with native controls in nested open roots, rather than a native <form>. */
export const smartrecruiters: Adapter = {
  ats: 'smartrecruiters',
  form,
  posting(doc, url) {
    const result = postingFrom(doc, url, 'smartrecruiters', {
      title: 'h1.job-title, h1',
      location: '.job-location',
      description: '.job-description',
    });
    const script = [...doc.scripts].find((node) => node.textContent?.includes('window.__OC_CONTEXT__'));
    const context = jsonAfter(script?.textContent ?? '', 'window.__OC_CONTEXT__') as {
      company?: { name?: string; companyIdentifier?: string };
      job?: { title?: string; location?: string };
      publicationExternalId?: string;
    } | null;
    if (!context) {
      const posting = /^\/([\w-]+)\/(\d+)(?:-|\/|$)/.exec(new URL(url).pathname);
      return posting
        ? { ...result, url: `https://jobs.smartrecruiters.com/${posting[1]}/${posting[2]}` }
        : result;
    }
    const company = context.company?.companyIdentifier,
      id = context.publicationExternalId;
    return {
      ...result,
      company: context.company?.name || result.company,
      title: context.job?.title || result.title,
      location: context.job?.location || result.location,
      url:
        company && id && /^[\w-]+$/.test(company) && /^\d+$/.test(id)
          ? `https://jobs.smartrecruiters.com/${company}/${id}`
          : (cleanLink(url) ?? url),
    };
  },
  custom(root) {
    const fields: CustomField[] = [];
    const add = (
      host: Element,
      field: Omit<CustomField, 'anchor' | 'required' | 'options'> & { options?: string[] },
    ) => {
      if (!componentHidden(host))
        fields.push({ anchor: host, required: required(host), options: [], entry: entryOf(host), ...field });
    };
    // Only outer text components: a phone or autocomplete has its own nested spl-input.
    for (const host of shadowElements(root, 'spl-input, spl-textarea')) {
      if (across(host, 'spl-autocomplete, spl-phone-field, spl-date-field, spl-multiselect-autocomplete'))
        continue;
      const input = shadowElements<HTMLInputElement | HTMLTextAreaElement>(
        host,
        'input:not([type="hidden"]), textarea',
      )[0];
      if (!input || input.disabled) continue;
      add(host, {
        label: label(host),
        kind: input.tagName === 'TEXTAREA' ? 'textarea' : input.type === 'email' ? 'email' : 'text',
        hint: hints[host.id] ?? entryHint(host),
        handle: { type: 'input', element: input },
      });
    }
    for (const host of shadowElements(root, 'spl-autocomplete')) {
      if (across(host, 'spl-multiselect-autocomplete')) continue;
      const input = shadowElements<HTMLInputElement>(host, 'input[role="combobox"], input')[0];
      if (input && !input.disabled)
        add(host, {
          label: label(host),
          kind: 'typeahead',
          hint:
            entryHint(host) ??
            (host.getAttribute('data-test') === 'location-autocomplete' && !entryOf(host)
              ? 'location'
              : null),
          handle: { type: 'typeahead', element: input },
        });
    }
    for (const host of shadowElements(root, 'spl-phone-field')) {
      const input = shadowElements<HTMLInputElement>(host, 'input[type="tel"]')[0];
      if (input && !input.disabled)
        add(host, {
          label: label(host),
          kind: 'tel',
          hint: 'phone',
          handle: { type: 'input', element: input },
        });
    }
    for (const host of shadowElements(root, 'spl-date-field[type="month-year"]')) {
      const input = shadowElements<HTMLInputElement>(host, 'input[data-input]:not([type="hidden"])')[0];
      if (input && !input.disabled && !input.readOnly)
        add(host, {
          label: label(host),
          kind: 'date',
          hint: entryHint(host),
          handle: { type: 'input', element: input, dateFormat: 'month-name-year' },
        });
    }
    for (const host of shadowElements(root, 'spl-radio-group')) {
      const radios = shadowElements(host, 'spl-radio').filter((radio) => {
        const input = shadowElements<HTMLInputElement>(radio, 'input[type="radio"]')[0];
        return input && !input.disabled && !componentHidden(radio);
      });
      const inputs = radios.map(
        (radio) => shadowElements<HTMLInputElement>(radio, 'input[type="radio"]')[0]!,
      );
      // A radio's native input is inside its own root, so give the shared setter its visible option text.
      const options = radios.map(label);
      if (inputs.length && inputs.length === options.length)
        add(host, {
          label: label(host),
          kind: 'radio',
          options,
          handle: { type: 'radio', inputs, labels: options },
        });
    }
    for (const host of shadowElements(root, 'spl-checkbox')) {
      const input = shadowElements<HTMLInputElement>(host, 'input[type="checkbox"]')[0];
      if (input && !input.disabled)
        add(host, {
          label: label(host),
          kind: 'checkbox',
          hint: entryHint(host),
          handle: { type: 'checkbox', element: input },
        });
    }
    for (const host of shadowElements(root, 'spl-multiselect-autocomplete')) {
      const input = shadowElements<HTMLInputElement>(host, 'input[role="combobox"], input[type="text"]')[0];
      if (input && !input.disabled)
        add(host, {
          label: label(host),
          kind: 'multi',
          handle: {
            type: 'prompt',
            element: input,
            multiple: true,
            shown: () => shadowElements(host, 'spl-tag').map(optionText).filter(Boolean),
          },
        });
    }
    for (const host of shadowElements(root, 'spl-select')) {
      const button = shadowElements<HTMLElement>(host, 'button[role="combobox"]')[0];
      if (!button || button.hasAttribute('disabled')) continue;
      const options = shadowOptions(host);
      add(host, {
        label: label(host) || 'Country code',
        kind: 'combobox',
        hint: /country code/i.test(label(host)) ? 'phone.country' : null,
        options: options.map(optionText),
        handle: {
          type: 'combobox',
          element: button,
          shown: () => {
            const value = host.getAttribute('value');
            return value
              ? optionText(
                  shadowOptions(host).find((option) => option.getAttribute('value') === value) ?? button,
                ) || null
              : null;
          },
        },
      });
    }
    // The top "apply with resume" dropzone is a second, automatic parser. Attach only to the application document.
    for (const host of shadowElements(root, 'spl-dropzone[data-test="resume-upload"]')) {
      const input = shadowElements<HTMLInputElement>(host, 'input[type="file"]')[0];
      if (input)
        add(host, {
          label: 'Resume',
          kind: 'file',
          hint: 'resume',
          handle: { type: 'file', element: input },
        });
    }
    return fields;
  },
  emails(doc) {
    const root = form(doc);
    return root
      ? [
          ...new Set(
            shadowElements<HTMLInputElement>(root, 'input[type="email"]')
              .map((input) => input.value.trim())
              .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)),
          ),
        ]
      : [];
  },
  submitButton(doc) {
    const root = form(doc);
    return (
      (root
        ? shadowElements<HTMLElement>(root, 'oc-button[data-test="footer-submit"], spl-button, button')
        : []
      ).find(
        (button) =>
          !componentHidden(button) &&
          (button.getAttribute('data-test') === 'footer-submit' ||
            /^(?:submit|send)(?: my)? application$/i.test(componentText(button).trim())),
      ) ?? null
    );
  },
  step(doc) {
    const root = doc.querySelector('oc-screening-questions-form');
    return root && !componentHidden(root) ? 'Screening questions' : form(doc) ? 'Profile' : null;
  },
  async prepare(root, counts) {
    let changed = false;
    for (const kind of ['experience', 'education'] as const) {
      const section = root.querySelector(`oc-${kind}`);
      // One entry is edited at a time. Existing entries and drafts remain under the owner's control.
      if (!section || !counts[kind] || section.querySelector(`oc-${kind}-entry`)) continue;
      const add = section.querySelector<HTMLElement>(`oc-button[data-test="add-${kind}"]`);
      if (!add || componentHidden(add)) continue;
      clickLikeAPerson(add);
      changed = !!(await waitFor(() => section.querySelector(`oc-${kind}-edit-form`), 1500, 50)) || changed;
    }
    return changed;
  },
  confirmed(doc) {
    const success = doc.querySelector('oc-application-success, [data-test="application-success"]');
    return (
      !!success &&
      !componentHidden(success) &&
      /application.*(?:sent|submitted|received)|thank you for applying/i.test(componentText(success))
    );
  },
  blank(root) {
    for (const host of root.querySelectorAll(
      'spl-input, spl-textarea, spl-phone-field, spl-select, spl-autocomplete',
    ))
      host.removeAttribute('value');
  },
};
