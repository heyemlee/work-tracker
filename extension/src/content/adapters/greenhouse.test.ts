import { describe, expect, it } from 'vitest';
import { planForm } from '../../plan';
import { pickOption } from '../../rules/options';
import { loadFixture } from '../../test/fixtures';
import { makeProfile } from '../../test/profiles';
import { extractFields } from '../extract';
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
