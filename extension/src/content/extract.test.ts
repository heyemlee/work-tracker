import { describe, expect, it } from 'vitest';
import { planForm } from '../plan';
import { makeProfile } from '../test/profiles';
import { generic } from './adapters/generic';
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

  it('names a group of radios by the label that names the group, star and all', () => {
    // Cursor's own careers form (it posts to Ashby): each question's label names its radios' name, which no
    // element has for an id, and each choice is a label round its radio.
    document.body.innerHTML = `<form id="application-form">
      <label for="q1">Will you now or in the future require visa sponsorship?<span aria-label="required">*</span></label>
      <div><label><input type="radio" name="q1"><span>Yes</span></label><label><input type="radio" name="q1"><span>No</span></label></div>
      <label for="survey:1:_systemfield_eeoc_gender"><strong>Gender</strong></label>
      <div><label><input type="radio" name="survey:1:_systemfield_eeoc_gender"><span>Male</span></label><label><input type="radio" name="survey:1:_systemfield_eeoc_gender"><span>Female</span></label></div>
    </form>`;
    const { fields } = extractFields(greenhouse, document, 0);
    expect(fields.map(({ label, required, options }) => ({ label, required, options }))).toEqual([
      {
        label: 'Will you now or in the future require visa sponsorship?',
        required: true,
        options: ['Yes', 'No'],
      },
      { label: 'Gender', required: false, options: ['Male', 'Female'] },
    ]);
  });

  it('reads a star in a label’s own text as required, though the label is read without it', () => {
    // A career site's own form: its stars are text, with no attribute or class to go by.
    document.body.innerHTML = `<form id="application-form">
      <label for="first">First name *</label><input id="first">
      <div class="field"><label>Email<span>*</span></label><input id="email" type="email"></div>
      <label for="site">Website</label><input id="site">
      <label for="cv">Resume *</label><input id="cv" type="file">
      <fieldset><legend>Are you 18 or older? ✱</legend><label><input type="radio" name="age">Yes</label><label><input type="radio" name="age">No</label></fieldset>
    </form>`;
    const { fields } = extractFields(generic, document, 0);
    expect(fields.map(({ label, required }) => ({ label, required }))).toEqual([
      { label: 'First name', required: true },
      { label: 'Email', required: true },
      { label: 'Website', required: false },
      { label: 'Resume', required: true },
      { label: 'Are you 18 or older?', required: true },
    ]);
  });

  it('names each field in a section by its own label, never by the section’s heading', () => {
    // Pinpoint's form (Brivo's, 2026-10-21): each field's label sits beside it with no `for`, and the section's legend
    // offers "Apply with LinkedIn". Read by the legend, the street, city and zip were filled with the LinkedIn link.
    document.body.innerHTML = `<form id="application-form">
      <fieldset><legend><div><span>1.</span>Personal Details<p>We'll need these details in order to be able to contact you.</p></div><div><a href="#"><span>Apply with LinkedIn</span></a></div></legend>
        <div class="col-1-1"><label class="external-form__label external-form__label--required" for="first">First Name</label><input required id="first" name="application_form[application][first_name]"></div>
        <div class="col-1-1"><label for="linkedin"><span class="external-form__label">LinkedIn URL</span></label><input id="linkedin" type="text"></div>
        <div class="col-1-1"><div class="frow">
          <div class="col-1-1"><label class="external-form__label external-form__label--required">Country</label><div class="react-select"><div class="react-select__control"><div class="react-select__value-container"><div class="react-select__input-container"><input id="application_form[application][country]" role="combobox"></div></div></div></div></div>
          <div class="col-1-1"><label class="external-form__label external-form__label--required">Street Address</label><input name="application_form[application][address1]" id="address1" required placeholder="Street Address"></div>
          <div class="col-1-1"><label class="external-form__label external-form__label--required">City</label><input name="application_form[application][address2]" id="address2" required></div>
          <div class="col-1-1"><label class="external-form__label external-form__label--required">Zipcode</label><input name="application_form[application][postcode]" id="postcode" required></div>
        </div></div>
      </fieldset>
      <fieldset><legend><span>2.</span> Profile</legend>
        <div><div class="external-form__label"><div class="external-form__label--required">Résumé / CV</div>
          <span>Accepted file formats are .pdf and .docx</span></div>
          <div class="file-field"><input type="file" id="cv" name="application_form[application][cv]"><label for="cv">Attach Résumé / CV</label></div></div>
        <div><label class="external-form__label" for="summary"><div>Personal Summary</div>
          <span>This section is optional.</span></label><textarea id="summary"></textarea></div>
      </fieldset>
      <fieldset><legend><span>3.</span>Questions</legend>
        <div><label class="external-form__label" for="salary"><span class="external-form__label--title external-form__label--required">What is your desired fixed (base) salary for this position?</span></label><input id="salary" type="number" required></div>
        <div><label class="external-form__label" for="answers_3_boolean_answer"><span class="external-form__label--title external-form__label--required">Are you legally eligible to work in the U.S.?</span></label>
          <div><div><div id="answer-label-3-true" style="display: none">Are you legally eligible to work in the U.S.? yes</div><input type="radio" id="answers_3_true" name="answers[3]" aria-labelledby="answer-label-3-true"><label for="answers_3_true">Yes</label></div>
          <div><input type="radio" id="answers_3_false" name="answers[3]"><label for="answers_3_false">No</label></div></div></div>
      </fieldset>
    </form>`;
    const { fields } = extractFields(generic, document, 0);
    expect(fields.map(({ label, required }) => ({ label, required }))).toEqual([
      { label: 'First Name', required: true },
      { label: 'LinkedIn URL', required: false },
      { label: 'Country', required: true },
      { label: 'Street Address', required: true },
      { label: 'City', required: true },
      { label: 'Zipcode', required: true },
      { label: 'Résumé / CV Accepted file formats are .pdf and .docx', required: true },
      // A mark elsewhere in the section isn't this field's: the summary is optional, and isn't written by AI.
      { label: 'Personal Summary This section is optional.', required: false },
      { label: 'What is your desired fixed (base) salary for this position?', required: true },
      { label: 'Are you legally eligible to work in the U.S.?', required: true },
    ]);
    const profile = makeProfile({
      address: {
        line1: '1 Main St',
        city: 'Santa Clara',
        state: 'CA',
        zip: '95050',
        country: 'United States',
      },
    });
    const plan = planForm(
      fields,
      {
        profile,
        email: 'alex@example.com',
        resumeId: 'resume-1',
        posting: null,
        today: '2026-10-21',
        appliedBefore: false,
      },
      [],
    );
    const typed = Object.fromEntries(
      plan.map((entry, index) => [
        fields[index]!.label,
        entry.answer?.type === 'text' ? entry.answer.text : entry.key,
      ]),
    );
    expect(typed).toMatchObject({
      // Known for what it asks, and left empty: the form doesn't ask for it.
      'LinkedIn URL': 'links.linkedin',
      'Street Address': '1 Main St',
      City: 'Santa Clara',
      Zipcode: '95050',
      'Résumé / CV Accepted file formats are .pdf and .docx': 'resume',
    });
  });

  it('leaves a field with no name of its own in a section nameless, not named by the section', () => {
    // Nameless, no rule answers it and it isn't put to AI: it's left to the owner.
    document.body.innerHTML = `<form id="application-form"><fieldset><legend>Apply with LinkedIn</legend>
      <div><label class="label" for="first">First Name</label><input id="first"></div>
      <div><input id="mystery"></div>
    </fieldset></form>`;
    expect(extractFields(greenhouse, document, 0).fields.map((field) => field.label)).toEqual([
      'First Name',
      '',
    ]);
  });

  it('gives the next page in the tab ids of its own', () => {
    // AI's answer for a field of the posting left behind arrives as the next one's form is up: it names no field there.
    document.body.innerHTML =
      '<form id="application-form"><label for="a">Why us?</label><textarea id="a"></textarea><label for="b">Website</label><input id="b"></form>';
    const left = extractFields(greenhouse, document, 0, fieldIds()).fields.map((field) => field.id);
    const next = extractFields(greenhouse, document, 0, fieldIds()).fields.map((field) => field.id);
    expect(next.filter((id) => left.includes(id))).toEqual([]);
  });
});
