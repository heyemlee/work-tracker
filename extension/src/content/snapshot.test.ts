import { describe, expect, it } from 'vitest';
import { loadFixture } from '../test/fixtures';
import { gem } from './adapters/gem';
import { generic } from './adapters/generic';
import type { Handle } from './adapters/types';
import { extractFields } from './extract';
import { formSnapshot, pageSnapshot } from './snapshot';

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

describe('a fill report of a page no form was read on', () => {
  /**
   * Made up: a step of an application whose questions the card couldn't read, as Indeed Apply's are left, answered;
   * the owner greeted at the top and summed up below, as such steps do; the card drawn into it.
   */
  const step = () => {
    const doc = document.implementation.createHTMLDocument('Indeed Apply');
    doc.body.innerHTML =
      '<header><span>Hi, Alex</span> <span>Signed in as ALEX CHEN</span> <span>alex@example.com</span></header>' +
      '<main><h1>Answer these questions from the employer</h1><form>' +
      '<fieldset><legend>Are you legally authorized to work in the United States?</legend>' +
      '<label><input type="radio" name="auth" value="yes" checked> Yes</label>' +
      '<label><input type="radio" name="auth" value="no"> No</label></fieldset>' +
      '<label for="years">How many years of Python experience do you have?</label>' +
      '<input id="years" type="number" value="3">' +
      '<label for="why">Why this role?</label><textarea id="why">Because I like robots.</textarea>' +
      '<div contenteditable="true">My cover note</div>' +
      '<input type="hidden" name="csrf" value="token-123"></form>' +
      '<section aria-label="Your contact information for Alex Chen"><p>Alex Chen</p><p>+1 (408) 555-0100</p>' +
      '<p>1 Infinite Loop, Cupertino, CA</p><a href="mailto:recruiting@acme.example">Write to us</a></section></main>' +
      '<script>window.applicant = "Alex Chen";</script><outbox-autofill></outbox-autofill>';
    return doc;
  };
  const owner = { words: ['Alex', 'Chen', '1 Infinite Loop'], phone: '4085550100' };

  it('keeps the page, blanked as a form is, without its scripts or the card', () => {
    const { html, fields } = pageSnapshot(generic, step(), null, owner)!;
    expect(fields).toEqual([]);
    for (const text of [
      'Answer these questions from the employer',
      'Are you legally authorized to work in the United States?',
      'How many years of Python experience do you have?',
      'Why this role?',
    ])
      expect(html).toContain(text);
    for (const text of ['checked', 'value="3"', 'Because I like robots', 'My cover note', 'token-123'])
      expect(html).not.toContain(text);
    expect(html).not.toMatch(/<script|outbox-autofill/);
  });

  it('leaves the owner out of what the page says: their names, street and phone, and every email', () => {
    const { html } = pageSnapshot(generic, step(), null, owner)!;
    expect(html).not.toMatch(/alex|chen|infinite loop|555|@|example\.com/i);
    // What isn't theirs alone stays: the greeting's words, the town.
    expect(html).toContain('Hi,');
    expect(html).toContain('Cupertino, CA');
    expect(html).toContain('Your contact information for');
  });

  it("takes out what a page's own trackers and file buttons say of the answers", () => {
    // Cursor's form: Google Tag Manager marks each control a visitor touched, and the upload's button names the file.
    document.body.innerHTML = `<form data-gtm-form-interact-id="0"><label for="r">Resume</label>
      <input id="r" type="file" data-gtm-form-interact-field-id="0"><button type="button">🗎 Alex_Chen_Resume.pdf</button>
      <label><input type="radio" name="g" data-gtm-form-interact-field-id="6"><span>Male</span></label>
      <label><input type="radio" name="g"><span>Female</span></label><p>Upload .pdf or .docx</p></form>`;
    const { html } = pageSnapshot(generic, document, null)!;
    expect(html).not.toMatch(/gtm|Resume\.pdf/);
    expect(html).toContain('Upload .pdf or .docx');
  });

  it('leaves the page itself as it was', () => {
    const doc = step();
    const before = doc.body.innerHTML;
    pageSnapshot(generic, doc, null, owner);
    expect(doc.body.innerHTML).toBe(before);
  });
});
