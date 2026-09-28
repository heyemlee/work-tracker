import { describe, expect, it } from 'vitest';
import { attachedFile } from './extract';

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
