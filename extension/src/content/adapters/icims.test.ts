import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { planForm } from '../../plan';
import { makeProfile } from '../../test/profiles';
import { applyAnswer } from '../apply';
import { extractFields } from '../extract';
import { heldBy } from '../held';
import { watchSubmission } from '../submit';
import { icims } from './icims';

function page(withCredentials = false) {
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = readFileSync(
    resolve(__dirname, '../../../test/fixtures/new-ats/icims-candidate.html'),
    'utf8',
  );
  // The login part is drawn as Rivian's Candidate Profile draws its "Create a login" (2026-10-19).
  if (!withCredentials) doc.querySelector('[data-local-credentials]')!.remove();
  return doc;
}
const url =
  'https://careers-example.icims.com/jobs/123/example-role/candidate?from=login&code=private-test-code&eem=private-test-email#private-test-fragment';
function questionsPage() {
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = readFileSync(
    resolve(__dirname, '../../../test/fixtures/new-ats/icims-questions.html'),
    'utf8',
  );
  return doc;
}

it('recognizes the real question-only stage and keeps authorization answers marked for owner review', () => {
  const doc = questionsPage();
  const { fields } = extractFields(icims, doc, 1);
  expect(fields).toHaveLength(2);
  expect(fields.map((f) => ({ kind: f.kind, required: f.required, options: f.options }))).toEqual([
    { kind: 'select', required: true, options: ['Yes', 'No'] },
    { kind: 'select', required: true, options: ['Yes', 'No'] },
  ]);
  const plan = planForm(
    fields,
    {
      profile: makeProfile(),
      email: 'alex@example.com',
      resumeId: null,
      posting: null,
      today: '2026-10-14',
      appliedBefore: false,
    },
    [],
  );
  expect(plan.map((p) => ({ status: p.status, critical: p.critical, key: p.key }))).toEqual([
    { status: 'confirm', critical: true, key: 'auth.authorized' },
    { status: 'confirm', critical: true, key: 'auth.sponsorship' },
  ]);
  expect(icims.step!(doc)).toBe('Candidate questions');
  expect(icims.posting(doc, url.replace('/candidate?', '/questions?'))?.url).toBe(
    'https://careers-example.icims.com/jobs/123/example-role/job',
  );
  doc.querySelector('h2')!.textContent = 'Unrelated survey';
  expect(icims.form(doc)).toBeNull();
});

it('does not count profile Next, Finish Later or a middle-step Submit as an application attempt', () => {
  for (const doc of [page(), questionsPage()]) {
    const form = icims.form(doc)!;
    const attempt = vi.fn();
    const confirmed = vi.fn();
    const stop = watchSubmission(icims, doc, attempt, confirmed);
    try {
      const save = doc.querySelector<HTMLElement>('#cp_form_submit_i, #quesp_form_save_i')!;
      form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: save }));
      expect(attempt).not.toHaveBeenCalled();
      if (doc.querySelector('#quesp_form_submit_i')) {
        const submit = doc.querySelector<HTMLElement>('#quesp_form_submit_i')!;
        expect(icims.submitButton(doc)).toBeNull();
        submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: submit }));
        expect(attempt).not.toHaveBeenCalled();
        expect(confirmed).not.toHaveBeenCalled();
      }
    } finally {
      stop();
    }
  }
});

it.each(['last', 'absent'])('keeps final question submission detection when progress is %s', (progress) => {
  const doc = questionsPage();
  // Derived variants for regression: neither is a captured final step from this employer.
  if (progress === 'last') doc.querySelector('.iCIMS_Steps li:last-child')!.remove();
  else doc.querySelector('.iCIMS_Steps')!.remove();
  const form = icims.form(doc)!;
  const submit = doc.querySelector<HTMLElement>('#quesp_form_submit_i')!;
  const attempt = vi.fn();
  const confirmed = vi.fn();
  const stop = watchSubmission(icims, doc, attempt, confirmed);
  try {
    expect(icims.submitButton(doc)).toBe(submit);
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: submit }));
    expect(attempt).toHaveBeenCalledExactlyOnceWith([]);
    expect(confirmed).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it('fills a Candidate Profile that creates a login, and leaves the login to the owner', () => {
  const doc = page(true);
  expect(icims.applying!(doc, url)).toBe(true);
  expect(icims.form(doc)).toBe(doc.querySelector('#profileForm'));
  const { fields } = extractFields(icims, doc, 1);
  expect(fields.map((f) => f.label)).toEqual(extractFields(icims, page(), 1).fields.map((f) => f.label));
  expect(fields.some((f) => /login|password/i.test(f.label))).toBe(false);
  expect(icims.submitButton(doc)).toBeNull();
  expect(icims.posting(doc, url)?.url).toBe('https://careers-example.icims.com/jobs/123/example-role/job');
});

it('maps source-confirmed profile IDs and keeps salary components distinctly labelled', () => {
  const doc = page();
  const { fields } = extractFields(icims, doc, 1);
  expect(fields.find((f) => f.hint === 'phone.type')).toMatchObject({ label: 'Type', required: true });
  expect(fields.find((f) => f.hint === 'phone')).toMatchObject({ label: 'Number' });
  expect(fields.find((f) => f.hint === 'email')).toMatchObject({ label: 'Email', required: true });
  expect(fields.find((f) => f.hint === 'address.line1')).toMatchObject({ label: 'Address' });
  expect(fields.filter((f) => f.kind === 'file')).toMatchObject([{ hint: 'resume', required: true }]);
  expect(fields.filter((f) => f.label.startsWith('Desired Salary Min')).map((f) => f.label)).toEqual([
    'Desired Salary Min Currency',
    'Desired Salary Min Amount',
    'Desired Salary Min Timeframe',
  ]);
  expect(fields.some((f) => /referral/.test(f.label))).toBe(false);
  expect(icims.submitButton(doc)).toBeNull(); // Next saves candidate data; it is not final submission.
});

it('reads required from the anchor and treats a nonempty native placeholder as empty', () => {
  const doc = page();
  const { fields, handles } = extractFields(icims, doc, 1);
  for (const hint of ['address.country', 'address.state']) {
    const field = fields.find((f) => f.hint === hint)!;
    expect(field).toMatchObject({ required: true, filled: false, options: [] });
    expect(heldBy(handles.get(field.id)!)).toEqual({ filled: false });
  }
  doc.querySelector<HTMLSelectElement>('[id="-1_PersonProfileFields.AddressState"]')!.disabled = true;
  expect(extractFields(icims, doc, 1).fields.some((f) => f.hint === 'address.state')).toBe(false);
});

it('chooses a lazily loaded menu option even when the native select initially contains only a placeholder', async () => {
  const doc = page();
  const select = doc.querySelector<HTMLSelectElement>('[id="-1_PersonProfileFields.AddressCountry"]')!;
  const anchor = doc.querySelector<HTMLElement>(
    '[id="-1_PersonProfileFields.AddressCountry_icimsDropdown"]',
  )!;
  const menu = doc.querySelector<HTMLElement>(
    '[id="-1_PersonProfileFields.AddressCountry_dropdown-results"]',
  )!;
  anchor.onclick = () => {
    menu.innerHTML =
      '<li role="option" title="United States">United States</li><li role="option" title="Canada">Canada</li>';
    menu.hidden = false;
    for (const option of menu.children)
      (option as HTMLElement).onclick = () => {
        const selected = doc.createElement('option');
        selected.value = selected.text = option.textContent!;
        selected.selected = true;
        select.replaceChildren(selected);
        anchor.querySelector('.dropdown-text')!.textContent = option.textContent;
        menu.hidden = true;
      };
  };
  const { fields, handles } = extractFields(icims, doc, 1);
  const f = fields.find((f) => f.hint === 'address.country')!;
  expect(select.options).toHaveLength(1);
  expect(f.options).toEqual([]);
  expect(
    await applyAnswer(
      handles.get(f.id)!,
      { type: 'choice', want: { kind: 'like', texts: ['Canada'] }, option: null },
      async () => null,
    ),
  ).toMatchObject({ ok: true, value: 'Canada' });
  expect(select.options).toHaveLength(1);
  expect(heldBy(handles.get(f.id)!)).toMatchObject({ filled: true, value: 'Canada' });
  expect(extractFields(icims, doc, 1).fields.find((f) => f.hint === 'address.country')?.filled).toBe(true);
});
