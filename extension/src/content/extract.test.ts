import { describe, expect, it } from 'vitest';
import { greenhouse } from './adapters/greenhouse';
import { readAnswer } from './apply';
import { attachedFile, extractFields, fieldIds, heldFile, isFilled } from './extract';
import { setFiles } from './widgets';

const upload = (markup: string) => {
  document.body.innerHTML = markup;
  return document.querySelector<HTMLInputElement>('input[type="file"]')!;
};

describe('attachedFile', () => {
  it('sees a resume the page shows by name next to its upload', () => {
    const lever = upload(
      '<li class="application-question"><label>Resume/CV</label><input type="file" name="resume"><span class="filename">Alex_Chen_Resume.pdf</span></li>',
    );
    expect(attachedFile(lever)).toBe('Alex_Chen_Resume.pdf');
    const workday = upload(
      '<div data-automation-id="resumeSection"><div data-automation-id="file-upload-drop-zone"><input type="file" data-automation-id="file-upload-input-ref"></div><div data-automation-id="file-upload-item"><div>Alex Chen - Resume 2026.docx</div><div>Successfully Uploaded!</div></div></div>',
    );
    expect(attachedFile(workday)).toBe('Alex Chen - Resume 2026.docx');
  });

  it('reads upload instructions as no file', () => {
    const input = upload(
      '<div class="field"><label>Resume</label><input type="file"><p>Accepted file types: pdf, doc, docx</p><p>Supported: .pdf, .docx</p><span>Upload .pdf</span><span class="filename"></span></div>',
    );
    expect(attachedFile(input)).toBeNull();
  });
});

describe('heldFile', () => {
  it('takes the page’s word for what an upload holds, where the adapter reads it, over the input’s', () => {
    const input = upload('<div class="field"><label>Resume</label><input type="file"></div>');
    setFiles(input, [new File(['%PDF-1.4'], 'Alex_Chen_Resume.pdf', { type: 'application/pdf' })]);
    let shown: string | null = null;
    const read = { type: 'file' as const, element: input, shown: () => shown };
    // The input holds a file the page has let go of.
    expect(heldFile({ type: 'file', element: input })).toBe('Alex_Chen_Resume.pdf');
    expect(heldFile(read)).toBeNull();
    expect(isFilled(read)).toBe(false);
    // And the page holds one that never reached the input.
    shown = 'Dropped_By_Hand.pdf';
    expect(heldFile(read)).toBe('Dropped_By_Hand.pdf');
    expect(isFilled(read)).toBe(true);
  });
});

describe('extractFields', () => {
  it('counts a city picked in Greenhouse’s search box as filled, though the input itself is empty', () => {
    const city = (picked: string) => `<form id="application-form"><div class="select__control">
      ${picked}<label for="candidate-location">Location (City)</label><input id="candidate-location" role="combobox">
    </div></form>`;
    document.body.innerHTML = city(
      '<div class="select__single-value">Santa Clara, California, United States</div>',
    );
    expect(extractFields(greenhouse, document, 0).fields[0]).toMatchObject({
      kind: 'typeahead',
      filled: true,
    });
    document.body.innerHTML = city('');
    expect(extractFields(greenhouse, document, 0).fields[0]).toMatchObject({
      kind: 'typeahead',
      filled: false,
    });
  });

  it('sees the pick in one of Greenhouse’s dropdowns, which sits beside the input’s own box', () => {
    // As its page draws a react-select: the pick in the value box, next to the box round the input, whose class
    // says "container" too.
    const dropdown = (picked: string) => `<form id="application-form">
      <label id="q-label" for="q">Have you used Arcadia?</label>
      <div class="select-shell remix-css-b62m3t-container"><div><div class="select__control">
        <div class="select__value-container${picked ? ' select__value-container--has-value' : ''}">
          ${picked ? `<div class="select__single-value remix-css-1dimb5e-singleValue">${picked}</div>` : ''}
          <div class="select__input-container remix-css-19bb58m"><input id="q" class="select__input" role="combobox" aria-labelledby="q-label"></div>
        </div></div></div></div></form>`;
    const read = (picked: string) => {
      document.body.innerHTML = dropdown(picked);
      const { fields, handles } = extractFields(greenhouse, document, 0);
      return { field: fields[0], answer: readAnswer(handles.get(fields[0]!.id)!) };
    };
    expect(read('Yes')).toMatchObject({
      field: { kind: 'combobox', filled: true },
      answer: { type: 'choice', option: 'Yes' },
    });
    expect(read('')).toMatchObject({ field: { kind: 'combobox', filled: false }, answer: null });
  });

  it("keeps a field's id when the page is read again, and gives a question that appeared a new one", () => {
    document.body.innerHTML =
      '<form id="application-form"><label for="a">First Name</label><input id="a"><label for="b">Hispanic or Latino?</label><select id="b"><option>Yes</option><option>No</option></select></form>';
    const ids = fieldIds();
    const before = extractFields(greenhouse, document, 0, ids).fields.map((field) => field.id);
    // Answering "No" brings up the race question above the others.
    document
      .querySelector('form')!
      .insertAdjacentHTML(
        'afterbegin',
        '<label for="c">Race</label><select id="c"><option>Asian</option></select>',
      );
    const after = extractFields(greenhouse, document, 0, ids).fields;
    expect(after.filter((field) => before.includes(field.id)).map((field) => field.label)).toEqual([
      'First Name',
      'Hispanic or Latino?',
    ]);
    expect(after.find((field) => field.label === 'Race')?.id).not.toBeOneOf(before);
  });
});
