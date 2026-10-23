import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planForm } from '../../plan';
import { pickOption } from '../../rules/options';
import { loadFixture } from '../../test/fixtures';
import { makeProfile } from '../../test/profiles';
import { extractFields } from '../extract';
import { formSnapshot } from '../snapshot';
import { greenhouse } from './greenhouse';

describe('greenhouse', () => {
  const url = 'https://job-boards.greenhouse.io/discord/jobs/8811574002';
  const doc = loadFixture('greenhouse/discord.html', url);

  it('reads the posting', () => {
    const posting = greenhouse.posting(doc, url);
    expect(posting).toMatchObject({
      company: 'Discord',
      title: 'Senior Full-Stack Software Engineer, Developer Success',
      url,
    });
    expect(posting?.location).toContain('San Francisco');
    expect(posting?.description.length).toBeGreaterThan(500);
  });

  it('finds every field with its label, kind and meaning', () => {
    const { fields } = extractFields(greenhouse, doc, 0);
    const summary = fields.map(
      (field) => `${field.kind} ${field.hint ?? '-'} ${field.required ? '*' : ' '} ${field.label}`,
    );
    process.stderr.write(summary.join('\n') + '\n');
    expect(fields.find((field) => field.hint === 'name.first')).toMatchObject({
      label: 'First Name',
      kind: 'text',
      required: true,
    });
    expect(fields.find((field) => field.hint === 'resume')).toMatchObject({ kind: 'file' });
    expect(fields.find((field) => field.hint === 'eeo.gender')).toMatchObject({ kind: 'combobox' });
  });
});

// Scale AI's education section, from the owner's snapshot.
const EDUCATION = `
<form id="application-form">
  <div><label id="start-month--0-label" for="start-month--0">Start date month</label>
    <input id="start-month--0" type="text" role="combobox" aria-labelledby="start-month--0-label"></div>
  <div><label id="start-year--0-label" for="start-year--0">Start date year<span aria-hidden="true">*</span></label>
    <input id="start-year--0" aria-label="Start date year" aria-required="true" type="number"></div>
  <div><label id="end-year--0-label" for="end-year--0">End date year</label>
    <input id="end-year--0" aria-label="End date year" type="number"></div>
  <div><label for="question_1">When can you start?</label><input id="question_1" type="text"></div>
</form>`;

// The school, degree and field of study above those dates, as Greenhouse's react-select draws them.
const select = (id: string, label: string) => `
  <div class="select-shell"><label id="${id}-label" for="${id}">${label}</label>
    <div class="select__control"><input id="${id}" type="text" role="combobox" aria-labelledby="${id}-label"></div></div>`;
const SCHOOLS = `<form id="application-form">${[0, 1]
  .map(
    (n) =>
      select(`school--${n}`, 'School') +
      select(`degree--${n}`, 'Degree') +
      select(`discipline--${n}`, 'Discipline'),
  )
  .join('')}</form>`;

describe('greenhouse education', () => {
  it('searches for each school by name and answers its degree and field', () => {
    document.body.innerHTML = SCHOOLS;
    const { fields } = extractFields(greenhouse, document, 0);
    expect(fields.map((field) => `${field.kind} ${field.hint} ${field.entry?.index}`)).toEqual([
      'typeahead education.school 0',
      'combobox education.degree 0',
      'combobox education.field 0',
      'typeahead education.school 1',
      'combobox education.degree 1',
      'combobox education.field 1',
    ]);
    const plan = planForm(
      fields,
      {
        profile: makeProfile(),
        email: 'alex@example.com',
        resumeId: null,
        posting: null,
        today: '2026-10-06',
        appliedBefore: false,
      },
      [],
    );
    // What each dropdown offers once opened; a school is typed in full.
    const offered = [
      "Bachelor's Degree",
      'Master of Business Administration (M.B.A.)',
      "Master's Degree",
      'Computer Science',
      'Software Engineering',
      'Other',
    ];
    const shown = plan.map(({ answer }) =>
      answer?.type === 'text'
        ? answer.text
        : answer?.type === 'choice'
          ? pickOption(offered, answer.want)
          : null,
    );
    // The newest school first: the master's, then the bachelor's.
    expect(shown).toEqual([
      'Santa Clara University',
      "Master's Degree",
      'Computer Science',
      'Example University',
      "Bachelor's Degree",
      'Software Engineering',
    ]);
  });

  it("answers a school's start and end from that school, not from when the owner can start", () => {
    document.body.innerHTML = EDUCATION;
    const { fields } = extractFields(greenhouse, document, 0);
    expect(fields[0]).toMatchObject({ hint: 'education.start', entry: { kind: 'education', index: 0 } });
    const plan = planForm(
      fields,
      {
        profile: makeProfile(),
        email: 'alex@example.com',
        resumeId: null,
        posting: null,
        today: '2026-09-30',
        appliedBefore: false,
      },
      [],
    );
    // The newest school first: the master's, September 2023 to June 2025.
    expect(plan.map((entry) => entry.answer)).toEqual([
      { type: 'choice', want: { kind: 'like', texts: ['September', 'Sep', '09'] }, option: null },
      { type: 'text', text: '2023' },
      { type: 'text', text: '2025' },
      { type: 'text', text: 'Two weeks after an offer' },
    ]);
  });
});

// What "This page didn't fill right" saves of a Greenhouse page. The saved page has none of Greenhouse's code, so
// each answer is drawn here as that code drew it on its own page, served from this machine (2026-10-08).
describe('a fill report of a Greenhouse page', () => {
  const url = 'https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=8044460';
  const page = () => loadFixture('greenhouse/stripe-embed.html', url);
  const report = (doc: Document) => formSnapshot(greenhouse, doc, extractFields(greenhouse, doc, 0), [])!;

  /** The phone box as intl-tel-input draws it round the input, once the page's code has run. */
  function phone(doc: Document, country: { name: string; code: string; flag: string } | null): void {
    const input = doc.querySelector('#phone')!;
    const box = doc.createElement('div');
    box.className = 'iti iti--allow-dropdown iti--show-flags iti--inline-dropdown';
    input.replaceWith(box);
    box.innerHTML =
      '<div class="iti__country-container" style="left: 0px;"><button type="button" class="iti__selected-country"' +
      ` aria-expanded="false" aria-label="${country ? `Change country, selected ${country.name} (${country.code})` : 'Select country'}"` +
      ` aria-haspopup="dialog" aria-controls="iti-0__dropdown-content" title="${country?.name ?? 'Select country'}">` +
      `<div class="iti__selected-country-primary"><div class="iti__flag iti__${country?.flag ?? 'globe'}"></div>` +
      '<div class="iti__arrow" aria-hidden="true"></div></div></button></div>';
    box.append(input);
  }

  /** A file an upload holds: named where its buttons were, with a button to take it off. */
  function attach(doc: Document, field: string, name: string): void {
    doc.querySelector(`[aria-labelledby="upload-label-${field}"] .file-upload__wrapper`)!.innerHTML =
      '<div class="file-upload__filename"><svg class="svg-icon" viewBox="0 0 24 24"></svg>' +
      `<p class="body body__secondary">${name}</p><button type="button" class="icon-button icon-button--sm"` +
      ' aria-label="Remove file"><svg class="svg-icon" viewBox="0 0 24 24"></svg></button></div>';
  }

  /** Answers one question of each kind whose answer Greenhouse keeps in markup of its own. */
  function answer(doc: Document): void {
    // Typed text: React keeps the input's value attribute in step with it.
    const first = doc.querySelector<HTMLInputElement>('#first_name')!;
    first.value = 'Alexandra';
    first.setAttribute('value', 'Alexandra');
    // A dropdown's pick, where its prompt was.
    const box = doc.getElementById('gender')!.closest('.select__value-container')!;
    box.classList.add('select__value-container--has-value');
    box.querySelector('.select__placeholder')!.outerHTML =
      '<div class="select__single-value remix-css-1dimb5e-singleValue">Decline To Self Identify</div>';
    phone(doc, { name: 'United Kingdom', code: '+44', flag: 'gb' });
    attach(doc, 'resume', 'Alex_Chen_Resume.pdf');
    attach(doc, 'cover_letter', 'Alex_Chen_Cover_Letter.pdf');
  }

  it('names neither an attached file nor the country of the phone number', () => {
    const doc = page();
    answer(doc);
    const { html } = report(doc);
    for (const text of [
      'Alexandra',
      'Decline To Self Identify',
      'Alex_Chen',
      'United Kingdom',
      '+44',
      'iti__gb',
    ])
      expect(html).not.toContain(text);
    // An upload still shows that it holds a file, as a dropdown shows that it holds a pick: not which.
    const saved = document.implementation.createHTMLDocument('');
    saved.body.innerHTML = html;
    expect([...saved.querySelectorAll('.file-upload__filename')].map((line) => line.innerHTML)).toEqual([
      '',
      '',
    ]);
    expect(
      saved.querySelector('.select__value-container--has-value .select__single-value')?.textContent,
    ).toBe('');
  });

  it('saves the phone box the same with a country chosen as with none', () => {
    const chosen = page();
    phone(chosen, { name: 'United Kingdom', code: '+44', flag: 'gb' });
    const none = page();
    phone(none, null);
    expect(report(chosen).html).toBe(report(none).html);
  });

  it('still reads as the form it was', () => {
    const doc = page();
    answer(doc);
    const saved = document.implementation.createHTMLDocument('');
    saved.body.innerHTML = report(doc).html;
    const read = (from: Document) =>
      extractFields(greenhouse, from, 0).fields.map(({ label, kind, options, required }) => ({
        label,
        kind,
        options,
        required,
      }));
    expect(read(saved)).toEqual(read(doc));
  });
});

describe('once the resume is attached to a Greenhouse form', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The upload box as Greenhouse draws it while the file is on its way; returns a way to end the upload. */
  function uploading() {
    document.body.innerHTML =
      '<div class="file-upload"><div class="file-upload__wrapper"><div role="progressbar" class="file-upload__progressbar"></div></div></div>';
    return () => {
      document.querySelector('.file-upload__wrapper')!.innerHTML =
        '<div class="file-upload__filename"><span>resume.pdf</span></div>';
    };
  }

  /** How long the fill waits before it goes on, in ms. */
  async function waited() {
    const started = Date.now();
    const waiting = greenhouse.resumeRead!(document).then(() => Date.now() - started);
    await vi.runAllTimersAsync();
    return waiting;
  }

  it('goes on only when the upload is over, however long it takes', async () => {
    for (const ms of [1500, 9000]) {
      setTimeout(uploading(), ms);
      const took = await waited();
      expect(took).toBeGreaterThanOrEqual(ms);
      expect(took).toBeLessThanOrEqual(ms + 150);
    }
  });

  it('goes on after a moment where no upload is under way', async () => {
    document.body.innerHTML = '<div class="file-upload__filename"><span>resume.pdf</span></div>';
    expect(await waited()).toBeLessThanOrEqual(400);
  });

  it('waits no longer than half a minute for an upload that never ends', async () => {
    uploading();
    expect(await waited()).toBeLessThanOrEqual(31_000);
  });
});
