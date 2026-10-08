import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Posting, ScannedField } from '../model';
import { holdTranslation, isTranslated, leaveUntranslated, ownWords } from './words';

const field = (
  id: string,
  label: string,
  options: string[] = [],
  more: Partial<ScannedField> = {},
): ScannedField => ({
  id,
  label,
  description: '',
  kind: options.length ? 'radio' : 'text',
  options,
  required: false,
  hint: null,
  section: '',
  entry: null,
  filled: false,
  maxLength: null,
  ...more,
});

const posting = (title: string, url = 'https://jobs.ashbyhq.com/acme/1'): Posting => ({
  ats: 'ashby',
  company: 'Acme',
  title,
  url,
  location: null,
  description: '',
});

/** Chrome's mark on a document it shows translated, put on or taken off. */
const translated = (on: boolean) => document.documentElement.classList.toggle('translated-ltr', on);

/** A reading of the page, with the page's own words put back into it. */
function read(
  words: ReturnType<typeof ownWords>,
  fields: ScannedField[],
  more: { posting?: Posting; step?: string } = {},
) {
  const reading = { fields, posting: more.posting ?? null, step: more.step ?? null };
  words.keep(reading);
  return reading;
}

const RACE = ['Asian', 'White', 'Decline to self-identify'];
const RACE_ZH = ['亚裔', '白人', '拒绝自我识别'];

afterEach(() => {
  document.documentElement.className = '';
});

describe('a page the browser shows translated', () => {
  it('is told by the mark Chrome puts on the document', () => {
    expect(isTranslated(document)).toBe(false);
    document.documentElement.className = 'no-js translated-ltr';
    expect(isTranslated(document)).toBe(true);
    document.documentElement.className = 'translated-rtl';
    expect(isTranslated(document)).toBe(true);
    document.documentElement.className = 'untranslated-ltr';
    expect(isTranslated(document)).toBe(false);
  });
});

describe('the page’s own words', () => {
  it('are the page’s words as they stand, while it isn’t translated', () => {
    const words = ownWords(document);
    expect(read(words, [field('f1', 'Race', RACE)]).fields[0]).toMatchObject({
      label: 'Race',
      options: RACE,
    });
    // The page words a question anew itself: that is the question now.
    expect(read(words, [field('f1', 'Ethnicity', RACE)]).fields[0]?.label).toBe('Ethnicity');
    expect(words.choices('f1')).toEqual(RACE);
  });

  it('are put back for a field read before the page was translated', () => {
    const words = ownWords(document);
    read(words, [
      field('f1', 'Race', RACE, { description: 'Voluntary', section: 'Equal opportunity' }),
      field('f2', 'Name'),
    ]);
    translated(true);
    const { fields } = read(words, [
      field('f1', '种族', RACE_ZH, { description: '自愿', section: '平等机会' }),
      field('f2', '姓名'),
    ]);
    expect(fields[0]).toMatchObject({
      label: 'Race',
      options: RACE,
      description: 'Voluntary',
      section: 'Equal opportunity',
    });
    expect(fields[1]?.label).toBe('Name');
    expect(words.choices('f1')).toEqual(RACE);
    // And again, however often the page is read.
    expect(read(words, [field('f1', '种族', RACE_ZH)]).fields[0]?.label).toBe('Race');
  });

  it('leaves what the reading says of the field besides its words', () => {
    const words = ownWords(document);
    read(words, [field('f1', 'Race', RACE)]);
    translated(true);
    const [now] = read(words, [field('f1', '种族', RACE_ZH, { filled: true, required: true })]).fields;
    expect(now).toMatchObject({ label: 'Race', filled: true, required: true });
  });

  it('are only the translation for a field first read translated, until the translation is taken back', () => {
    const words = ownWords(document);
    translated(true);
    expect(read(words, [field('f1', '种族', RACE_ZH)]).fields[0]?.label).toBe('种族');
    expect(read(words, [field('f1', '种族', RACE_ZH)]).fields[0]?.label).toBe('种族');
    translated(false);
    expect(read(words, [field('f1', 'Race', RACE)]).fields[0]?.label).toBe('Race');
    translated(true);
    expect(read(words, [field('f1', '种族', RACE_ZH)]).fields[0]).toMatchObject({
      label: 'Race',
      options: RACE,
    });
  });

  it('are not kept for a control that comes to hold another question', () => {
    const words = ownWords(document);
    read(words, [field('f1', 'Race', RACE)]);
    translated(true);
    expect(read(words, [field('f1', '种族', RACE_ZH)]).fields[0]?.label).toBe('Race');
    // The same control, worded otherwise again: another question, with nothing known of it but how it reads.
    const gender = ['男性', '女性', '拒绝自我识别'];
    expect(read(words, [field('f1', '性别', gender)]).fields[0]).toMatchObject({
      label: '性别',
      options: gender,
    });
    expect(words.choices('f1')).toEqual(gender);
    // Nor for one with another number of choices.
    expect(read(words, [field('f1', '性别', gender.slice(0, 2))]).fields[0]?.options).toEqual(
      gender.slice(0, 2),
    );
  });

  it('are not kept from one step of a form to the next', () => {
    const words = ownWords(document);
    read(words, [field('f1', 'First name')], { step: 'My Information' });
    translated(true);
    expect(read(words, [field('f1', '名')], { step: 'My Information' }).fields[0]?.label).toBe('First name');
    // The next step may draw its own question in the same control.
    expect(read(words, [field('f1', '街道地址')], { step: 'My Experience' }).fields[0]?.label).toBe(
      '街道地址',
    );
  });

  it('keep the posting for as long as its address is the same', () => {
    const words = ownWords(document);
    read(words, [], { posting: posting('Software Engineer') });
    translated(true);
    expect(read(words, [], { posting: posting('软件工程师') }).posting?.title).toBe('Software Engineer');
    // What the page says of it only now is taken as it reads: there are no words of the page's own for it.
    const late = { ...posting('软件工程师'), location: '旧金山' };
    expect(read(words, [], { posting: late }).posting).toMatchObject({
      title: 'Software Engineer',
      location: '旧金山',
    });
    // Another posting, in the same document: read as it is.
    const other = posting('数据工程师', 'https://jobs.ashbyhq.com/acme/2');
    expect(read(words, [], { posting: other }).posting?.title).toBe('数据工程师');
  });
});

describe('a form the browser’s translation is to leave alone', () => {
  const form = (doc: Document) => doc.querySelector('form.application');
  const marked = () => document.querySelector('form.application')?.getAttribute('translate');
  let stop = () => {};

  afterEach(() => {
    stop();
    document.body.innerHTML = '';
  });

  it('is marked where it stands, and nothing else of the page is', () => {
    document.body.innerHTML =
      '<main><h1>Software Engineer</h1><form class="application"><input></form></main>';
    stop = leaveUntranslated(document, form);
    expect(marked()).toBe('no');
    expect(document.querySelectorAll('[translate]')).toHaveLength(1);
  });

  it('is marked in the turn it is drawn in, and again when the page draws it anew', async () => {
    document.body.innerHTML = '<main><h1>Software Engineer</h1></main>';
    stop = leaveUntranslated(document, form);
    const draw = () => {
      document
        .querySelector('main')!
        .insertAdjacentHTML('beforeend', '<form class="application"><input></form>');
    };
    draw();
    // Not a timer later: the translation of what a page draws comes within a fraction of a second.
    await Promise.resolve();
    expect(marked()).toBe('no');

    document.querySelector('form.application')!.remove();
    draw();
    expect(marked()).toBeNull();
    await Promise.resolve();
    expect(marked()).toBe('no');
  });

  it('is left to the page once that is asked', async () => {
    document.body.innerHTML = '<main></main>';
    stop = leaveUntranslated(document, form);
    stop();
    document.querySelector('main')!.innerHTML = '<form class="application"><input></form>';
    await vi.waitFor(() => expect(document.querySelector('form.application')).not.toBeNull());
    await Promise.resolve();
    expect(marked()).toBeNull();
  });
});

describe('the translation held off while the page is worked', () => {
  afterEach(() => document.body.removeAttribute('translate'));

  it('marks the body for that while, and leaves it as the page had it', () => {
    const letGo = holdTranslation(document);
    expect(document.body.getAttribute('translate')).toBe('no');
    letGo();
    expect(document.body.hasAttribute('translate')).toBe(false);

    document.body.setAttribute('translate', 'yes');
    const again = holdTranslation(document);
    expect(document.body.getAttribute('translate')).toBe('no');
    again();
    expect(document.body.getAttribute('translate')).toBe('yes');
  });

  it('holds until the last of several at once has let go', () => {
    const fill = holdTranslation(document);
    const options = holdTranslation(document);
    fill();
    expect(document.body.getAttribute('translate')).toBe('no');
    // Letting go twice counts once.
    fill();
    expect(document.body.getAttribute('translate')).toBe('no');
    options();
    expect(document.body.hasAttribute('translate')).toBe(false);
  });
});
