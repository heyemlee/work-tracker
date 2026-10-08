import { describe, expect, it } from 'vitest';
import { loadFixture } from '../test/fixtures';
import { gem } from './adapters/gem';
import type { Handle } from './adapters/types';
import { extractFields } from './extract';
import { formSnapshot } from './snapshot';

// A page Gem's own code drew from a made-up posting with each of its kinds of question, before any was answered.
const url = 'https://jobs.gem.com/acme-robotics/am9icG9zdDr2DjIQ3bPcrRLp0z2TjYKi';
const page = () => loadFixture('gem/acme.html', url);

const SPONSORSHIP =
  'Will you now or in the future require sponsorship for employment visa status in the United States?';

/** What "This page didn't fill right" saves of a page. */
const report = (doc: Document) => formSnapshot(gem, doc, extractFields(gem, doc, 0), [])!;

/**
 * Answers one question of each kind, in the markup Gem's own code keeps an answer in. The saved page has none of
 * that code, so each answer is drawn here as that code drew it on its own page, served from this machine.
 */
function answer(doc: Document): void {
  const { fields, handles } = extractFields(gem, doc, 0);
  const handleOf = <T extends Handle['type']>(type: T, label: string) => {
    const handle = handles.get(fields.find((field) => field.label === label)!.id)!;
    if (handle.type !== type) throw new Error(`"${label}" is no ${type}`);
    return handle as Extract<Handle, { type: T }>;
  };
  /** The circle or box Gem draws for a choice, in the label after its input. */
  const markOf = (input: HTMLInputElement) => input.nextElementSibling!.firstElementChild!;

  // Typed text: React keeps the input's value attribute in step with it.
  const first = handleOf('input', 'First name').element;
  first.value = 'Alexandra';
  first.setAttribute('value', 'Alexandra');

  // A long answer: the textarea's text, repeated on the box round it, which grows to fit the text.
  const why = handleOf('input', 'Why do you want to work at Acme Robotics?').element;
  why.textContent = 'Because robots are the future.';
  why.value = 'Because robots are the future.';
  why.parentElement!.setAttribute('data-value', why.value);

  // A radio taken: its circle filled in, and the dot inside no longer hidden.
  const no = handleOf('radio', SPONSORSHIP).inputs[1]!;
  no.checked = true;
  markOf(no).className = 'outerCircle-118 selected-122';
  markOf(no).firstElementChild!.className = 'innerCircle-119';

  // Boxes ticked: filled in, with a checkmark drawn inside.
  for (const choice of [
    handleOf('multi', 'How did you hear about us?').inputs[1]!,
    handleOf('checkbox', 'Do you agree to our candidate privacy notice?').element,
  ]) {
    choice.checked = true;
    markOf(choice).className = 'box-149 checkedBox-151';
    markOf(choice).innerHTML = '<i class="container-11 small-13"><svg viewBox="0 0 24 24"></svg></i>';
  }

  // A dropdown's button reads its pick: one of the posting's own questions, and a voluntary one, where the arrow
  // is drawn in with the text.
  const legal = handleOf('combobox', 'Are you legally authorized to work in the United States?').element;
  legal.firstElementChild!.textContent = 'Authorized, on a visa';
  const gender = handleOf('combobox', 'Gender').element;
  gender.firstElementChild!.firstChild!.textContent = 'Decline to self-identify';

  // A rating's number pressed: "selected", and a "primary" button where the others are "secondary".
  const four = handleOf('buttons', 'How would you rate your Python?').buttons[3]!;
  four.className = `${four.className.replace('secondary-133', 'primary-132')} selected`;

  // A file held: named over the box with a ✕ beside the name, and the box offers to replace it.
  const upload = handleOf('file', 'Resume').element.closest('[role="presentation"]')!;
  upload.parentElement!.parentElement!.insertAdjacentHTML(
    'beforebegin',
    '<div class="fileContainer-99"><div class="body-41 primary-44">Alex_Chen_Resume.pdf</div>' +
      '<button type="button" class="button-186 extraSmall-187 light-192" aria-label="cross">' +
      '<i class="container-11 extraSmall-12"><svg viewBox="0 0 24 24"></svg></i></button></div>',
  );
  upload.querySelector('[class*="promptText"]')!.textContent = 'Click to replace or drag and drop here';
}

describe('a fill report of a Gem page', () => {
  it('holds no answer, though Gem keeps them in markup of its own', () => {
    const doc = page();
    answer(doc);
    // The page is answered, as the adapter reads it.
    expect(
      extractFields(gem, doc, 0)
        .fields.filter((field) => field.filled)
        .map((field) => field.label),
    ).toEqual([
      'First name',
      'Resume',
      'Why do you want to work at Acme Robotics?',
      SPONSORSHIP,
      'Are you legally authorized to work in the United States?',
      'How did you hear about us?',
      'Do you agree to our candidate privacy notice?',
      'How would you rate your Python?',
      'Gender',
    ]);

    const { html } = report(doc);
    for (const text of [
      'Alexandra',
      'robots are the future',
      'Authorized, on a visa',
      'Decline to self-identify',
      'Alex_Chen_Resume.pdf',
    ])
      expect(html).not.toContain(text);
    // Nor what was chosen, ticked or pressed, which Gem tells by class: it's the report of the page unanswered.
    expect(html).toBe(report(page()).html);
  });

  it('still reads as the form it was, with nothing filled in', () => {
    const doc = page();
    answer(doc);
    const saved = document.implementation.createHTMLDocument('');
    saved.body.innerHTML = report(doc).html;

    const read = (from: Document) =>
      extractFields(gem, from, 0).fields.map(({ label, kind, options, required, description }) => ({
        label,
        kind,
        options,
        required,
        description,
      }));
    expect(read(saved)).toEqual(read(doc));
    expect(extractFields(gem, saved, 0).fields.filter((field) => field.filled)).toEqual([]);
    // A dropdown prompts again, each in its own words: with no text, its button would pass for one holding a pick.
    expect(
      [...saved.querySelectorAll('[class*="buttonContentContainer"]')].map((says) => says.textContent),
    ).toEqual(['Select an option', 'Please select', 'Please select', 'Please select', 'Please select']);
  });

  it('leaves the page itself as it was', () => {
    const doc = page();
    answer(doc);
    const before = doc.body.innerHTML;
    report(doc);
    expect(doc.body.innerHTML).toBe(before);
  });
});
