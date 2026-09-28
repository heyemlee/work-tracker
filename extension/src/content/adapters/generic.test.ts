import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../test/fixtures';
import { extractFields } from '../extract';
import { generic, resumeForm } from './generic';

/** A page on a site the extension doesn't know. */
function page(body: string, url = 'https://careers.acme.com/jobs/123/apply'): Document {
  const doc = document.implementation.createHTMLDocument('Acme');
  doc.body.innerHTML = body;
  Object.defineProperty(doc, 'URL', { value: url });
  return doc;
}

const APPLICATION = `
  <form>
    <label for="first">First name</label><input id="first">
    <label for="last">Last name</label><input id="last">
    <label for="email">Email</label><input id="email" type="email">
    <label for="phone">Phone</label><input id="phone" type="tel">
    <label for="cv">Resume/CV</label><input id="cv" type="file">
    <button type="submit">Submit application</button>
  </form>`;

/** The same application drawn without a <form>, as React apps draw theirs. */
const FORMLESS = `
  <header><input type="search" placeholder="Search jobs"></header>
  <main>
    <h1>Software Engineer</h1>
    <div class="application">
      <div class="field"><label>Resume</label><div class="drop"><input type="file"><span>Upload file</span></div></div>
      <div class="field"><label>Name</label><input></div>
      <div class="field"><label>Email</label><input type="email"></div>
      <div class="field"><label>Phone</label><input type="tel"></div>
      <button>Submit application</button>
    </div>
  </main>`;

const SAVED = resolve(__dirname, '../../../test/fixtures');
const savedForms = ['greenhouse', 'lever', 'ashby'].flatMap((system) =>
  readdirSync(resolve(SAVED, system))
    .filter((name) => name.endsWith('.html'))
    .map((name) => `${system}/${name}`),
);

describe('opening the card by itself on a site the extension does not know', () => {
  it('opens for an application form with a resume upload', () => {
    expect(resumeForm(page(APPLICATION))?.tagName).toBe('FORM');
  });

  it('opens on every saved application page, read as if its site were unknown', () => {
    expect(savedForms.length).toBeGreaterThanOrEqual(22);
    for (const path of savedForms) {
      const doc = loadFixture(path, 'https://careers.acme.com/jobs/123/application');
      expect(resumeForm(doc), path).not.toBeNull();
    }
  });

  it('opens on a page drawn without a <form>, at a job address only', () => {
    expect(resumeForm(page(FORMLESS))?.className).toBe('application');
    // Mail, chat and drives keep uploads around; they aren't searched for a formless application.
    expect(resumeForm(page(FORMLESS, 'https://mail.example.com/u/0/'))).toBeNull();
  });

  it('leaves a contact form with an attachment alone', () => {
    const contact = `
      <form>
        <label for="name">Name</label><input id="name">
        <label for="email">Email</label><input id="email" type="email">
        <label for="message">Message</label><textarea id="message"></textarea>
        <label for="file">Attachment</label><input id="file" type="file">
      </form>`;
    expect(resumeForm(page(contact, 'https://www.acme.com/careers/contact'))).toBeNull();
  });

  it('leaves a sign-in page alone', () => {
    const signIn = `
      <form>
        <label for="email">Email</label><input id="email" type="email">
        <label for="password">Password</label><input id="password" type="password">
        <button type="submit">Sign in</button>
      </form>`;
    expect(resumeForm(page(signIn))).toBeNull();
  });

  it('leaves a resume upload without a name or email field alone', () => {
    const review = `
      <form>
        <label for="cv">Upload your resume for a free review</label><input id="cv" type="file">
        <label for="role">Target role</label><input id="role">
        <label for="years">Years of experience</label><input id="years">
      </form>`;
    expect(resumeForm(page(review))).toBeNull();
  });

  it('waits while the form is hidden', () => {
    expect(resumeForm(page(`<div hidden>${APPLICATION}</div>`))).toBeNull();
    expect(resumeForm(page(`<div aria-hidden="true">${APPLICATION}</div>`))).toBeNull();
  });
});

describe('filling a page drawn without a <form>', () => {
  it('reads the fields around the resume upload, not the search box above them', () => {
    const labels = extractFields(generic, page(FORMLESS, 'https://www.acme.com/'), 0).fields.map(
      (field) => field.label,
    );
    expect(labels).toEqual(['Resume', 'Name', 'Email', 'Phone']);
  });

  it('reads a saved Ashby page as an unknown site', () => {
    const doc = loadFixture('ashby/notion.html', 'https://careers.acme.com/jobs/123');
    const { fields } = extractFields(generic, doc, 0);
    expect(fields.some((field) => field.kind === 'file')).toBe(true);
    expect(fields.some((field) => field.kind === 'email' || /email/i.test(field.label))).toBe(true);
  });
});
