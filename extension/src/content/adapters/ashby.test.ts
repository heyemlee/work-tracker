import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../test/fixtures';
import { extractFields } from '../extract';
import { formSnapshot } from '../snapshot';
import { ashby } from './ashby';

// A page Ashby's own code drew from a made-up posting with one question of each kind its form has, and its
// voluntary questions, before any was answered.
const url = 'https://jobs.ashbyhq.com/acme-robotics/3f1c0d7e-8a53-4c1e-9d0b-2b7f6c1e0a11/application';
const page = () => loadFixture('ashby/acme.html', url);

const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const SPONSORSHIP = 'Will you now, or in the future, require sponsorship for employment visa status?';

/** What "This page didn't fill right" saves of a page. */
const report = (doc: Document) => formSnapshot(ashby, doc, extractFields(ashby, doc, 0), [])!;

/**
 * Answers one question of each kind, in the markup Ashby's own code keeps an answer in. The saved page has none of
 * that code, so each answer is drawn here as that code drew it on its own page, served from this machine.
 */
function answer(doc: Document): void {
  const entry = (title: string) =>
    [...doc.querySelectorAll('.ashby-application-form-question-title')]
      .find((label) => label.textContent === title)!
      .closest('[data-field-path], fieldset')!;
  /** Adds a class of Ashby's where its code puts one: in the gap it leaves for it, or at the end. */
  const draw = (element: Element, name: string) => {
    const names = element.getAttribute('class') ?? '';
    element.setAttribute(
      'class',
      names.includes('  ') ? names.replace('  ', ` ${name} `) : `${names} ${name}`,
    );
  };

  // Typed text, one line and many, a number, a date, and what a search was answered with: React keeps each input's
  // value attribute in step with it.
  for (const [selector, text] of [
    ['#_systemfield_name', 'Alexandra Chen'],
    ['#_systemfield_email', 'alexandra@example.com'],
    ['[data-field-path="_systemfield_location"] input', 'Santa Clara, California, United States'],
    ['input[type="number"]', '4'],
    ['.ashby-application-form-input-date', '11/02/2026'],
    ['input[placeholder="Search schools..."]', 'Santa Clara University'],
    ['[id$="-degree"]', 'Master of Science'],
  ] as const) {
    const input = doc.querySelector<HTMLInputElement>(selector)!;
    input.value = text;
    input.setAttribute('value', text);
  }
  doc.querySelector('textarea')!.value = 'Because robots are the future.';

  // Yes or No pressed: the button is "active" and says so to a screen reader.
  for (const [title, option] of [
    [AUTHORIZED, 'yes'],
    [SPONSORSHIP, 'no'],
  ] as const) {
    const button = entry(title).querySelector(`button[data-option="${option}"]`)!;
    draw(button, '_active_1svni_57');
    button.setAttribute('aria-pressed', 'true');
  }

  // A radio chosen and boxes ticked: the row, the circle or box and the label are each "checked", and a radio's row
  // says "true" where it said "false".
  const choose = (input: HTMLInputElement) => {
    input.checked = true;
    const row = input.closest('[class*="-group-option"]');
    for (const marked of [row, input.parentElement!]) marked?.setAttribute('data-checked', '');
    draw(input.parentElement!, input.type === 'radio' ? '_checked_132c8_90' : '_checked_1danv_87');
    if (input.type === 'radio') row?.classList.replace('false', 'true');
    const label = doc.querySelector(`label[for="${input.id}"]`);
    if (row && label) draw(label, '_checked_1258i_57');
  };
  const choices = (title: string) => [...entry(title).querySelectorAll<HTMLInputElement>('input')];
  choose(choices('How many years of relevant professional experience do you have?')[1]!);
  choose(choices('How did you hear about this opportunity? (select all that apply)')[0]!);
  choose(choices('How did you hear about this opportunity? (select all that apply)')[3]!);
  // The voluntary questions among them.
  choose(choices('Gender')[1]!);
  choose(choices('Race')[4]!);
  choose(choices('Veteran Status')[1]!);

  // A rating's number taken, a low one: the number is "valueSelected", and the scale's low end lights up.
  const rating = entry('How would you rate your Python?');
  const two = rating.querySelectorAll('label[class^="_value_"]')[1]!;
  two.setAttribute('class', '_value_1jkj9_28 _valueSelected_1jkj9_55');
  two.querySelector('input')!.checked = true;
  draw(rating.querySelector('[class^="_labels_"]')!.firstElementChild!, '_labelActive_1jkj9_89');

  // Files held: each named over its box, with a button to delete it, and the box's own button offers to replace the
  // one it holds, or to add to the several.
  const file = (name: string) =>
    '<div class="_file_10xk4_76 ashby-application-form-input-file-item">' +
    `<p class="_name_10xk4_41 ashby-application-form-input-file-item-name"><svg></svg><span>${name}</span></p>` +
    '<button title="Delete file" class="_button_zyh3g_28 _quaternary_zyh3g_92 _negative_zyh3g_172   ' +
    '_removeButton_10xk4_83 ashby-application-form-input-file-item-delete"><svg></svg></button></div>';
  const resume = entry('Resume').querySelector('.ashby-application-form-input-file')!;
  resume.querySelector('input')!.insertAdjacentHTML('afterend', file('Alex_Chen_Resume.pdf'));
  resume.querySelector('.ashby-application-form-input-file-dropzone-upload')!.innerHTML =
    '<span>Replace</span>';
  const others = entry('Other documents').querySelector('.ashby-application-form-input-file')!;
  others
    .querySelector('input')!
    .insertAdjacentHTML('afterend', file('Alex_Chen_Transcript.pdf') + file('Alex_Chen_Portfolio.pdf'));
  others.querySelector('.ashby-application-form-input-file-dropzone-upload')!.innerHTML =
    '<svg></svg><span>Add</span>';

  // A school attended from March to June of 2025: neither dropdown prompts any longer, and each date's lists stop
  // at the other date.
  const [fromMonth, fromYear, toMonth, toYear] = doc.querySelectorAll<HTMLSelectElement>(
    '.ashby-application-form-input-education-entry select',
  );
  const keep = (list: HTMLSelectElement, wanted: (value: number) => boolean, chosen: string) => {
    for (const option of [...list.options])
      if (option.value && !wanted(Number(option.value))) option.remove();
    list.value = chosen;
    const box = list.parentElement!;
    box.setAttribute('class', box.getAttribute('class')!.replace(' _placeholder_1mqj5_7', ''));
  };
  keep(fromMonth!, (month) => month <= 6, '3');
  keep(fromYear!, (year) => year <= 2025, '2025');
  keep(toMonth!, (month) => month >= 3, '6');
  keep(toYear!, (year) => year >= 2025, '2025');
}

/** A school still attended: the box is ticked, and the end date is shut. */
function stillStudent(doc: Document): void {
  const box = doc.querySelector<HTMLInputElement>('[id$="-isCurrent"]')!;
  box.checked = true;
  box.parentElement!.setAttribute('class', ' _container_1danv_28 _checked_1danv_87');
  box.parentElement!.setAttribute('data-checked', '');
  for (const list of doc.querySelectorAll<HTMLSelectElement>('[id$="-endDate"] select')) {
    list.setAttribute('disabled', '');
    list.parentElement!.setAttribute('data-disabled', '');
    list.parentElement!.setAttribute(
      'class',
      list.parentElement!.getAttribute('class')!.replace(' ashby-', ' _disabled_14jlb_85 ashby-'),
    );
  }
}

/**
 * The application sent: the form gives way to a box that says so, drawn here as Ashby's own code drew it on its own
 * page, served from this machine. Its words are Ashby's unless the company has written its own.
 */
function sent(
  doc: Document,
  words = "Your application was successfully submitted. We'll contact you if there are next steps.",
) {
  doc.querySelector('#form')!.innerHTML =
    '<div role="status" aria-live="polite" tabindex="-1" class="ashby-application-form-success-container ' +
    '_positive_f7cvd_112 _highlighted_f7cvd_138 _container_f7cvd_28" data-highlight="positive">' +
    `<h2 class="_heading_f7cvd_52 ">Success</h2><p>${words}</p></div>`;
}

describe('an Ashby application that went through', () => {
  it('is none while the form stands', () => {
    expect(ashby.confirmed(page(), url)).toBe(false);
  });

  it('is told by the box the form gives way to', () => {
    const doc = page();
    sent(doc);
    expect(ashby.confirmed(doc, url)).toBe(true);
  });

  it('is told whatever the company has the box say, and in whatever language it is read', () => {
    for (const words of [
      'Thanks for your interest in Acme Robotics! Our recruiting team will read what you sent and get back to you.',
      '您的申请已成功提交。如有后续步骤，我们会与您联系。',
    ]) {
      const doc = page();
      sent(doc, words);
      expect(ashby.confirmed(doc, url), words).toBe(true);
    }
  });

  it('is none where the box stands and the button that sends the form does too', () => {
    const doc = page();
    doc
      .querySelector('#form')!
      .insertAdjacentHTML('afterbegin', '<div class="ashby-application-form-success-container"></div>');
    expect(ashby.confirmed(doc, url)).toBe(false);
  });

  it('is told by its words where the page draws no such box', () => {
    const doc = page();
    doc.querySelector('#form')!.innerHTML = '<div class="_success_1"><p>Thanks for applying.</p></div>';
    expect(ashby.confirmed(doc, url)).toBe(true);
    doc.querySelector('#form')!.innerHTML = '<div class="_success_1"><p>Saved.</p></div>';
    expect(ashby.confirmed(doc, url)).toBe(false);
  });
});

describe('a fill report of an Ashby page', () => {
  it('holds no answer, though Ashby draws them in markup of its own', () => {
    const doc = page();
    answer(doc);
    // The page is answered, as the adapter reads it.
    const held = extractFields(ashby, doc, 0)
      .fields.filter((field) => field.filled)
      .map((field) => field.label);
    for (const label of [AUTHORIZED, SPONSORSHIP, 'Full Name', 'Gender', 'Race', 'Veteran Status'])
      expect(held).toContain(label);

    const { html } = report(doc);
    for (const text of [
      'Alexandra',
      'Santa Clara',
      'Master of Science',
      'robots are the future',
      '11/02/2026',
      'Alex_Chen',
      // What was pressed, chosen, ticked and rated, which Ashby tells by class and by attribute.
      '_active_',
      '_checked_',
      'data-checked',
      ' true ',
      '_valueSelected_',
      '_labelActive_',
      'Replace',
    ])
      expect(html.includes(text), text).toBe(false);
    // It's the report of the page unanswered.
    expect(html).toBe(report(page()).html);
  });

  it('gives a school’s dates every month and year back, and opens an end date "Still Student?" had shut', () => {
    const doc = page();
    answer(doc);
    stillStudent(doc);
    const saved = document.implementation.createHTMLDocument('');
    saved.body.innerHTML = report(doc).html;
    const lists = [...saved.querySelectorAll('.ashby-application-form-input-education-entry select')].map(
      (list) => [...list.querySelectorAll('option')].map((option) => option.getAttribute('value')),
    );
    const months = ['', ...Array.from({ length: 12 }, (_, month) => String(month + 1))];
    expect(lists[0]).toEqual(months);
    expect(lists[2]).toEqual(months);
    // The years run back from next year, as on the page before any was chosen.
    expect(lists[1]).toHaveLength(121);
    expect(lists[1]!.slice(0, 3)).toEqual(['', '2027', '2026']);
    expect(lists[3]).toEqual(lists[1]);
    expect(report(doc).html).toBe(report(page()).html);
  });

  it('still reads as the form it was, with nothing answered', () => {
    const doc = page();
    answer(doc);
    stillStudent(doc);
    const saved = document.implementation.createHTMLDocument('');
    saved.body.innerHTML = report(doc).html;
    const read = (from: Document) =>
      extractFields(ashby, from, 0).fields.map(({ label, kind, options, required, filled }) => ({
        label,
        kind,
        options,
        required,
        filled,
      }));
    expect(read(saved)).toEqual(read(page()));
  });

  it('leaves the page itself as it was', () => {
    const doc = page();
    answer(doc);
    const before = doc.body.innerHTML;
    report(doc);
    expect(doc.body.innerHTML).toBe(before);
  });
});
