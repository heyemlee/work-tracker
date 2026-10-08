import { cleanLink, companyFromSlug, parsePosting } from '@domain/postings';
import type { Posting } from '../../model';
import { attributeValue, textOf, waitFor } from '../dom';
import type { Adapter, CustomField } from './types';

/**
 * Gem draws its form without a <form>, and its controls carry no name, id or label of their own: a question is a
 * block with its text in a label-styled element and the control after it. Class names are the component's rule
 * name and a counter ("bodyImportant-47"), so they're matched by the name.
 */
const FORM = '[class*="formContainer"]';
const LABEL = '[class*="bodyImportant"]';
const REQUIRED = '[class*="requiredAsterisk"]';
const CONTROL = 'input, textarea, button';
/** The name of the file an upload holds, drawn over its box with a ✕ beside it for as long as it holds one. */
const FILE = '[class*="fileContainer"] > :not(button)';

/** What a dropdown's button says while nothing is chosen. */
const PROMPT = /^(please select|select an option)$/i;

/**
 * The box of the fields and the posting's own questions. The voluntary questions come after it, and their dropdowns
 * prompt in the other words.
 */
const QUESTIONS = '[class^="form-"], [class*=" form-"]';
/** The circle or box Gem draws for a choice, in the label after its input: filled in while the choice is taken. */
const MARK = 'input[type="radio"] + label > span, input[type="checkbox"] + label > span';

/** The block of the question a label heads; null for text shown between questions, which has no control. */
function blockOf(label: Element): Element | null {
  for (let node = label.parentElement; node && !node.matches(FORM); node = node.parentElement) {
    if (node.querySelectorAll(LABEL).length > 1) return null;
    if (node.querySelector(CONTROL)) return node;
  }
  return null;
}

/** A choice is an input and the label drawn for it, side by side. */
const choiceLabel = (input: HTMLInputElement) =>
  textOf(
    (input.id ? input.ownerDocument.querySelector(`label[for="${attributeValue(input.id)}"]`) : null) ??
      input.nextElementSibling,
  );

function fieldOf(label: Element): CustomField | null {
  const block = blockOf(label);
  if (!block) return null;
  const about = {
    label: textOf(label),
    // A question's own help text sits under its label, in a wrapper of the two.
    description: label.parentElement === block ? '' : textOf(label.nextElementSibling),
    required: label.querySelector(REQUIRED) !== null,
    anchor: block,
  };
  const inputs = (type: string) => [...block.querySelectorAll<HTMLInputElement>(`input[type="${type}"]`)];

  const radios = inputs('radio');
  if (radios.length)
    return {
      ...about,
      kind: 'radio',
      options: radios.map(choiceLabel),
      handle: { type: 'radio', inputs: radios },
    };
  const boxes = inputs('checkbox');
  const [box] = boxes;
  if (box)
    return boxes.length > 1
      ? { ...about, kind: 'multi', options: boxes.map(choiceLabel), handle: { type: 'multi', inputs: boxes } }
      : { ...about, kind: 'checkbox', options: [], handle: { type: 'checkbox', element: box } };
  const [upload] = inputs('file');
  if (upload)
    return {
      ...about,
      kind: 'file',
      options: [],
      // The file Gem holds is the one it names over the box, and not always the input's: its ✕ there forgets a
      // file the input goes on holding, and a file the owner drops onto the box, or picks in the dialog the box
      // opens, never reaches the input.
      handle: { type: 'file', element: upload, shown: () => textOf(block.querySelector(FILE)) || null },
    };
  const typed = block.querySelector<HTMLInputElement | HTMLTextAreaElement>('textarea, input');
  if (typed)
    return {
      ...about,
      kind: typed instanceof HTMLTextAreaElement ? 'textarea' : 'text',
      options: [],
      handle: { type: 'input', element: typed },
    };
  const buttons = [...block.querySelectorAll<HTMLElement>('button')];
  const [button] = buttons;
  if (!button) return null;
  // One button opens a list of choices, drawn at the end of the page. Several are a rating: 1 to 5, one pressed.
  return buttons.length === 1
    ? {
        ...about,
        kind: 'combobox',
        options: [],
        handle: { type: 'combobox', element: button },
        filled: !PROMPT.test(textOf(button)),
      }
    : {
        ...about,
        kind: 'radio',
        options: buttons.map((item) => textOf(item)),
        handle: { type: 'buttons', buttons },
      };
}

/** Every field of the form, each read from its block. */
const fieldsOf = (form: Element) =>
  [...form.querySelectorAll(LABEL)].flatMap((label) => {
    const field = fieldOf(label);
    return field ? [field] : [];
  });

/** The class an element has from a rule of Gem's stylesheet: "secondary-133" from the rule "secondary". */
const ruleClass = (element: Element, rule: string) =>
  [...element.classList].find((name) => name.startsWith(`${rule}-`));

/**
 * Takes the answers out of a copy of the form, for a fill report. Gem keeps them in markup of its own, where
 * emptying the inputs doesn't reach, and each goes back to what Gem draws for a question still unanswered.
 */
function blank(form: Element): void {
  // A long answer is repeated on the box round its textarea, which grows to fit the text.
  for (const box of form.querySelectorAll('[data-value]')) box.setAttribute('data-value', '');
  // A file an upload holds is named over its box, and the box offers to replace it.
  for (const named of form.querySelectorAll('[class*="fileContainer"]')) named.remove();
  for (const offer of form.querySelectorAll('[class*="promptText"]'))
    offer.textContent = (offer.textContent ?? '').replace('Click to replace', 'Click to upload');
  // A choice's mark is left bare, the same whether the choice was taken or not: its first class makes it a circle
  // or a box, and the others, with what's drawn inside it, tell a taken one from the rest.
  for (const mark of form.querySelectorAll(MARK)) {
    mark.className = mark.classList.item(0) ?? '';
    mark.replaceChildren();
  }
  // Bare buttons are told apart by their block, as they are when the form is read.
  for (const { handle, anchor } of fieldsOf(form)) {
    if (handle.type === 'combobox' && !PROMPT.test(textOf(handle.element))) {
      // A dropdown's button reads its pick. It prompts again: left empty, it would pass for one that holds a pick.
      const says = handle.element.querySelector('[class*="buttonContentContainer"]') ?? handle.element;
      for (const node of [...says.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.remove();
      says.prepend(anchor.closest(QUESTIONS) ? 'Select an option' : 'Please select');
    } else if (handle.type === 'buttons') {
      // A rating's number, once pressed, is "selected", and a "primary" button where the others are "secondary".
      const idle = handle.buttons.find((button) => !button.classList.contains('selected'));
      const plain = idle && ruleClass(idle, 'secondary');
      for (const button of handle.buttons) {
        const pressed = ruleClass(button, 'primary');
        if (pressed && plain) button.classList.replace(pressed, plain);
        button.classList.remove('selected');
      }
    }
  }
}

/** The posting as Gem describes it to search engines, where the board has that turned on. */
function structured(doc: Document): { title?: string; hiringOrganization?: { name?: string } } | null {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent ?? '') as Record<string, unknown>;
      if (data['@type'] === 'JobPosting') return data;
    } catch {
      // Not the posting's.
    }
  }
  return null;
}

export const gem: Adapter = {
  ats: 'gem',

  // The box is there before the form is drawn in it, and stays empty when the posting takes no applications here.
  form(doc) {
    const box = doc.querySelector(FORM);
    return box?.querySelector(CONTROL) ? box : null;
  },

  posting(doc, url): Posting | null {
    const header = doc.querySelector('[class*="jobPostingContent"] [class*="jobPostingHeader"]');
    const data = structured(doc);
    const title = textOf(header) || data?.title || null;
    // A board's list of jobs is no posting.
    if (!title) return null;
    const slug = parsePosting(url)?.companySlug;
    return {
      ats: 'gem',
      title,
      company: data?.hiringOrganization?.name || (slug ? companyFromSlug(slug, []) : null),
      url: cleanLink(url) ?? url,
      // Of the facts under the title, the place is the one drawn in an element of its own.
      location:
        textOf(doc.querySelector('[class*="attributesContainer"] [class*="iconLabel"] > span')) || null,
      description: [...doc.querySelectorAll('[class*="jobPostingContent"] [class*="typography"]')]
        .map((part) => textOf(part))
        .join(' ')
        .slice(0, 8000),
    };
  },

  // Nothing here names itself: every field is read from its block.
  skip: () => true,

  custom: fieldsOf,

  blank,

  // The form is drawn first, and the posting's data for search engines once the page has asked whether the board
  // gives any: until then the company is known by the board's name in the address ("11x Ai" for 11x.ai).
  postingLate: async (doc) => !structured(doc) && (await waitFor(() => structured(doc), 3000)) !== null,

  // "Apply and save" and "Apply without saving", or one "Apply".
  submitButton: (doc) => [...doc.querySelectorAll<HTMLElement>(`${FORM} button[type="submit"]`)],

  // The form gives way to "Congratulations! Your application for Growth Engineer has been received!".
  confirmed: (doc) => /your application for .+ has been received/i.test(textOf(doc.querySelector(FORM))),
};
