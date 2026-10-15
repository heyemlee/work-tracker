import { cleanLink } from '@domain/postings';
import type { Hint } from '../../model';
import { jsonAfter, textOf } from '../dom';
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
  textOf(host);
const required = (host: Element) =>
  host.hasAttribute('required') || host.getAttribute('aria-required') === 'true';
const componentText = (host: Element) =>
  textOf(host) || shadowElements(host, 'button, span').map(textOf).filter(Boolean).join(' ');

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
        fields.push({ anchor: host, required: required(host), options: [], ...field });
    };
    // Only outer text components: a phone or autocomplete has its own nested spl-input.
    for (const host of root.querySelectorAll('spl-input, spl-textarea')) {
      const input = shadowElements<HTMLInputElement | HTMLTextAreaElement>(
        host,
        'input:not([type="hidden"]), textarea',
      )[0];
      if (!input || input.disabled) continue;
      add(host, {
        label: label(host),
        kind: input.tagName === 'TEXTAREA' ? 'textarea' : input.type === 'email' ? 'email' : 'text',
        hint: hints[host.id] ?? null,
        handle: { type: 'input', element: input },
      });
    }
    for (const host of root.querySelectorAll('spl-autocomplete')) {
      const input = shadowElements<HTMLInputElement>(host, 'input[role="combobox"], input')[0];
      if (input && !input.disabled)
        add(host, {
          label: label(host),
          kind: 'typeahead',
          hint: host.getAttribute('data-test') === 'location-autocomplete' ? 'location' : null,
          handle: { type: 'typeahead', element: input },
        });
    }
    for (const host of root.querySelectorAll('spl-phone-field')) {
      const input = shadowElements<HTMLInputElement>(host, 'input[type="tel"]')[0];
      if (input && !input.disabled)
        add(host, {
          label: label(host),
          kind: 'tel',
          hint: 'phone',
          handle: { type: 'input', element: input },
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
    for (const host of root.querySelectorAll('spl-dropzone[data-test="resume-upload"]')) {
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
      [...(root?.querySelectorAll<HTMLElement>('spl-button, button') ?? [])].find(
        (button) =>
          !componentHidden(button) &&
          /^(?:submit|send)(?: my)? application$/i.test(componentText(button).trim()),
      ) ?? null
    );
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
