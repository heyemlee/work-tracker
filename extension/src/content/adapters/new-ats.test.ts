import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyAnswer as apply } from '../apply';
import { extractFields } from '../extract';
import { heldBy } from '../held';
import { formSnapshot } from '../snapshot';
import { watchSubmission } from '../submit';
import { adapterFor } from './index';
import { icims } from './icims';
import { jobvite } from './jobvite';
import { smartrecruiters } from './smartrecruiters';
import { workable } from './workable';
const applyAnswer = (handle: Parameters<typeof apply>[0], answer: Parameters<typeof apply>[1]) =>
  apply(handle, answer, async () => null);

function page(name: string) {
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = readFileSync(
    resolve(__dirname, '../../../test/fixtures/new-ats', `${name}.html`),
    'utf8',
  );
  function hydrate(root: ParentNode) {
    for (const template of root.querySelectorAll<HTMLTemplateElement>('template[data-shadow]')) {
      const host = template.parentElement!;
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.append(template.content.cloneNode(true));
      template.remove();
      hydrate(shadow);
    }
  }
  hydrate(doc);
  return doc;
}
const read = (name: string) => {
  const doc = page(name),
    adapter = { workable, jobvite, icims, smartrecruiters }[name]!;
  return { doc, adapter, ...extractFields(adapter, doc, 0) };
};

describe('additional ATS host routing', () => {
  it.each([
    ['https://careers-example.icims.com/jobs/123/job', 'icims'],
    ['https://jobs.smartrecruiters.com/oneclick-ui/company/Example/publication/123', 'smartrecruiters'],
    ['https://apply.workable.com/example/j/123/apply/', 'workable'],
    ['https://jobs.jobvite.com/example/job/123/apply', 'jobvite'],
    ['https://jobs.jobvite.com.evil.test/', 'generic'],
    ['https://noticims.com/', 'generic'],
    ['https://jobs.lever.co/example/123', 'lever'],
  ])('routes %s to %s', (url, expected) => expect(adapterFor(url).ats).toBe(expected));
});

it('Workable labels its generated upload controls and leaves the photo alone', () => {
  const { fields, adapter, doc } = read('workable');
  expect(fields.filter((f) => f.kind === 'file')).toMatchObject([{ hint: 'resume', label: 'Resume' }]);
  expect(fields.filter((f) => f.hint).map((f) => f.hint)).toEqual([
    'name.first',
    'name.last',
    'email',
    'phone',
    'resume',
  ]);
  expect(adapter.posting(doc, 'https://apply.workable.com/example/j/123/apply/')).toMatchObject({
    company: 'Example Labs',
    title: 'Software Engineer',
    url: 'https://apply.workable.com/example/j/123/',
  });
  doc.body.innerHTML = '<form><input name="email" type="email"></form>';
  expect(adapter.form(doc)).toBeNull();
});

it('Jobvite finds the resume outside the form without confusing it with the cover letter', () => {
  const { fields, handles, doc, adapter } = read('jobvite');
  const resume = fields.find((f) => f.hint === 'resume')!;
  expect(handles.get(resume.id)).toMatchObject({ type: 'file', element: doc.querySelector('#resume-file') });
  expect(fields.filter((f) => f.kind === 'file')).toHaveLength(1);
  expect(fields.find((f) => /sponsorship/.test(f.label))).toMatchObject({
    options: ['Yes', 'No'],
    kind: 'multi',
    required: true,
  });
  expect(adapter.submitButton(doc)).toBe(doc.querySelector('button[type="submit"]'));
});

it('iCIMS excludes login, password and search forms', () => {
  const doc = page('icims');
  for (const html of [
    '<form id="enterEmailForm"><input id="email" type="email"></form>',
    '<form><input id="PersonProfileFields.FirstName"><input id="PersonProfileFields.LastName"><input type="password"></form>',
    '<form id="searchForm"><input name="searchKeyword"></form>',
  ]) {
    doc.body.innerHTML = html;
    expect(icims.form(doc)).toBeNull();
  }
});

it('iCIMS never keeps candidate query credentials from a canonical link', () => {
  const doc = page('icims');
  const canonical = doc.createElement('link');
  canonical.rel = 'canonical';
  canonical.href =
    'https://careers-example.icims.com/jobs/123/software-engineer/login?code=private-test-code&eem=private-test-email';
  doc.head.append(canonical);
  expect(icims.posting(doc, canonical.href)?.url).toBe(
    'https://careers-example.icims.com/jobs/123/software-engineer/job',
  );
});

it('iCIMS picks through the visible dropdown and reads/clears the hidden selected value', async () => {
  const { doc, fields, handles } = read('icims');
  const country = fields.find((f) => f.hint === 'address.country')!;
  const handle = handles.get(country.id)!;
  expect(country.kind).toBe('combobox');
  const select = doc.querySelector('select')!;
  const anchor = doc.querySelector('a')!;
  const menu = doc.querySelector('ul')!;
  anchor.onclick = () => {
    menu.hidden = false;
  };
  for (const li of menu.querySelectorAll('li'))
    li.onclick = () => {
      select.value = li.dataset.value!;
      menu.hidden = true;
    };
  expect(
    await applyAnswer(handle, {
      type: 'choice',
      want: { kind: 'like', texts: ['Canada'] },
      option: 'Canada',
    }),
  ).toMatchObject({ ok: true });
  expect(select.value).toBe('CA');
  expect(heldBy(handle)).toMatchObject({ filled: true, value: 'Canada' });
  select.value = '';
  expect(heldBy(handle)).toEqual({ filled: false });
});

it('iCIMS snapshots remove displayed answers and candidate navigation credentials', () => {
  const { doc, adapter } = read('icims');
  const root = adapter.form(doc)!;
  root.setAttribute('action', '/profile?code=private-test-code');
  const anchor = root.querySelector('a')!;
  anchor.textContent = 'Private selected country';
  anchor.setAttribute('aria-valuetext', 'Private selected country');
  anchor.setAttribute('title', 'Private selected country');
  anchor.href = '/login?eem=private-test-email';
  const secret = doc.createElement('input');
  secret.type = 'hidden';
  secret.value = 'private-test-token';
  root.append(secret);
  const snapshot = formSnapshot(adapter, doc, extractFields(adapter, doc, 0), []);
  expect(snapshot?.html).not.toMatch(/private-test|Private selected country/);
  expect(snapshot?.html).toContain('PersonProfileFields.FirstName');
  expect(anchor.textContent).toBe('Private selected country'); // Only the copy was scrubbed.
});

it('SmartRecruiters reads nested roots once and selects only the application resume dropzone', () => {
  const { fields, adapter, doc, handles } = read('smartrecruiters');
  expect(fields.filter((f) => f.hint === 'location')).toHaveLength(1);
  expect(fields.filter((f) => f.hint === 'phone')).toHaveLength(1);
  expect(fields.filter((f) => f.kind === 'file')).toHaveLength(1);
  const resume = fields.find((f) => f.hint === 'resume')!;
  expect(handles.get(resume.id)).toMatchObject({
    element: doc.querySelector('[data-test="resume-upload"]')!.shadowRoot!.querySelector('input'),
  });
  expect(adapter.submitButton(doc)).toBeNull(); // Next is never submission.
  expect(
    adapter.posting(doc, 'https://jobs.smartrecruiters.com/oneclick-ui/company/ExampleLabs/publication/uuid'),
  ).toMatchObject({
    company: 'Example Labs',
    title: 'Software Engineer',
    url: 'https://jobs.smartrecruiters.com/ExampleLabs/12345',
  });
});

it('SmartRecruiters fills its shadow input, picks a nested city suggestion and keeps manual text', async () => {
  const { fields, handles, doc } = read('smartrecruiters');
  const first = fields.find((f) => f.hint === 'name.first')!,
    city = fields.find((f) => f.hint === 'location')!;
  const firstHandle = handles.get(first.id)!;
  expect(await applyAnswer(firstHandle, { type: 'text', text: 'Alex' })).toMatchObject({ ok: true });
  expect(heldBy(firstHandle)).toMatchObject({ filled: true, value: 'Alex' });
  expect(extractFields(smartrecruiters, doc, 0).fields.find((f) => f.hint === 'name.first')?.filled).toBe(
    true,
  );
  const host = doc.querySelector('spl-autocomplete')!,
    input = host.shadowRoot!.querySelector('spl-input')!.shadowRoot!.querySelector('input')!;
  const list = host.shadowRoot!.querySelector('div')!;
  input.oninput = () => {
    list.innerHTML =
      '<spl-autocomplete-option role="option" label="Santa Clara, California, United States">Santa Clara, California, United States</spl-autocomplete-option>';
    (list.firstElementChild as HTMLElement).onclick = () => {
      input.value = list.firstElementChild!.getAttribute('label')!;
      list.innerHTML = '';
    };
  };
  expect(await applyAnswer(handles.get(city.id)!, { type: 'text', text: 'Santa Clara, CA' })).toMatchObject({
    ok: true,
  });
  expect(input.value).toBe('Santa Clara, California, United States');
});

it('SmartRecruiters watches only final submission and captures the shadow email', () => {
  const { doc } = read('smartrecruiters');
  const email = doc.querySelector('#email-input')!.shadowRoot!.querySelector('input')!;
  email.value = 'alex@example.com';
  const attempt = vi.fn(),
    confirmed = vi.fn();
  const stop = watchSubmission(smartrecruiters, doc, attempt, confirmed);
  doc.querySelector('spl-button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(attempt).not.toHaveBeenCalled();
  const submit = doc.createElement('spl-button');
  submit.textContent = 'Submit application';
  doc.querySelector('oc-oneclick-form')!.append(submit);
  submit.click();
  expect(attempt).toHaveBeenCalledWith(['alex@example.com']);
  expect(confirmed).not.toHaveBeenCalled();
  stop();
});
