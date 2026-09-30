import { describe, expect, it } from 'vitest';
import { greenhouse } from './adapters/greenhouse';
import { attachedFile, extractFields, fieldIds } from './extract';

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

describe('extractFields', () => {
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
