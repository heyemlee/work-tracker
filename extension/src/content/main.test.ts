import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FrameHeld, FrameScan, PlannedField } from '../model';
import { startContent } from './main';

const FORM = `
<form>
  <label for="name">Full name</label><input id="name">
  <label for="email">Email</label><input id="email" type="email">
  <label for="phone">Phone</label><input id="phone">
  <label for="org">Current company</label><input id="org">
  <label for="linkedin">LinkedIn</label><input id="linkedin">
  <label for="resume">Resume</label><input id="resume" type="file">
</form>`;

type Respond = (value: unknown) => void;
type Listener = (message: object, sender: object, respond: Respond) => boolean;

/** Ends the content script's watching of the page, which outlives a test otherwise. */
let stop = () => {};

/** Starts the content script on the page and returns a way to message it as the service worker does. */
function start() {
  let listener: Listener | undefined;
  vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener').mockImplementation(((fn: Listener) => {
    listener ??= fn;
  }) as never);
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (message: { type: string }) =>
    message.type === 'resume:read'
      ? { base64: btoa('%PDF-1.4'), name: 'Alex_Chen_Resume.pdf', type: 'application/pdf' }
      : undefined) as never);
  stop = startContent();
  return <T>(message: object) =>
    new Promise<T>((resolve) => listener!(message, {}, (value) => resolve(value as T)));
}

const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;

function plan(scan: FrameScan, texts: Record<string, string>): PlannedField[] {
  return scan.fields.map((field) => {
    const id = {
      'Full name': 'name',
      Email: 'email',
      Phone: 'phone',
      'Current company': 'org',
      LinkedIn: 'linkedin',
    }[field.label];
    return {
      fieldId: field.id,
      status: 'filled',
      answer:
        field.kind === 'file'
          ? { type: 'file', resumeId: 'res-1' }
          : { type: 'text', text: texts[id ?? ''] ?? '' },
      source: 'rule',
      key: id === 'email' ? 'email' : (id ?? null),
      note: null,
      critical: false,
    };
  });
}

const ANSWERS = {
  name: 'Alex Chen',
  email: 'alex@example.com',
  phone: '+1 650 555 0199',
  org: 'Acme AI',
  linkedin: 'https://www.linkedin.com/in/alex-chen',
};

afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

describe('filling a page that fills fields of its own', () => {
  it('keeps what the resume parser and the owner put there, and fills the rest', async () => {
    const ask = start();
    document.body.innerHTML = FORM;
    // The owner typed a phone number before filling; the page reads the resume once it's uploaded.
    input('phone').value = '+1 408 555 0100';
    input('resume').addEventListener('change', () => {
      input('name').value = 'Alexander Chen';
      input('email').value = 'alex.chen@example.com';
      input('org').value = 'Acme AI Labs';
    });

    const scan = await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
    const results = await ask<Record<string, { ok: boolean; value?: string }>>({
      type: 'frame:fill',
      fields: plan(scan, ANSWERS),
    });

    expect(input('resume').files?.[0]?.name).toBe('Alex_Chen_Resume.pdf');
    expect(input('name').value).toBe('Alexander Chen');
    expect(input('org').value).toBe('Acme AI Labs');
    expect(input('phone').value).toBe('+1 408 555 0100');
    // The email names the account applying, whatever the resume says.
    expect(input('email').value).toBe('alex@example.com');
    expect(input('linkedin').value).toBe('https://www.linkedin.com/in/alex-chen');
    const name = scan.fields.find((field) => field.label === 'Full name')!;
    expect(results[name.id]).toMatchObject({ ok: true, value: 'Alexander Chen' });
  });

  it('fills its own answers again, and still leaves the page’s alone', async () => {
    const ask = start();
    document.body.innerHTML = FORM;
    input('org').value = 'Acme AI Labs';
    const fill = async (answers: Record<string, string>) => {
      const scan = await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
      await ask({
        type: 'frame:fill',
        fields: plan(scan, answers).filter((entry) => entry.answer?.type !== 'file'),
      });
      return scan;
    };

    const first = await fill(ANSWERS);
    expect(first.fields.find((field) => field.label === 'LinkedIn')?.filled).toBe(false);
    const second = await fill({ ...ANSWERS, linkedin: 'https://www.linkedin.com/in/alexchen' });
    // Its own answer isn't the page's: the next scan reads it as open, and the next fill replaces it.
    expect(second.fields.find((field) => field.label === 'LinkedIn')?.filled).toBe(false);
    expect(input('linkedin').value).toBe('https://www.linkedin.com/in/alexchen');
    expect(input('org').value).toBe('Acme AI Labs');
  });
});

describe('filling again once the owner has gone on by hand', () => {
  it('leaves an answer of its own the owner put theirs in place of, and fills one they emptied', async () => {
    const ask = start();
    document.body.innerHTML = FORM;
    const fill = async (answers: Record<string, string>) => {
      const scan = await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
      await ask({
        type: 'frame:fill',
        fields: plan(scan, answers).filter((entry) => entry.answer?.type !== 'file'),
      });
      return scan;
    };
    await fill(ANSWERS);

    // The owner corrects the phone, empties the company, and types another email.
    input('phone').value = '+1 999 000 1111';
    input('org').value = '';
    input('email').value = 'someone@else.example';
    const again = await fill({ ...ANSWERS, linkedin: 'https://www.linkedin.com/in/alexchen' });

    // Theirs now: read as the page's, and left alone.
    expect(again.fields.find((field) => field.label === 'Phone')?.filled).toBe(true);
    expect(input('phone').value).toBe('+1 999 000 1111');
    // Empty is empty, whoever emptied it.
    expect(input('org').value).toBe('Acme AI');
    // What stands as this script left it is still its own to redo.
    expect(input('linkedin').value).toBe('https://www.linkedin.com/in/alexchen');
    // And the email names the account applying, whatever was typed there.
    expect(input('email').value).toBe('alex@example.com');
  });
});

describe('filling again: what isn’t redone while it stands', () => {
  it('does not fire page saves again for unchanged answers, but applies changes and fills cleared fields', async () => {
    const ask = start();
    document.body.innerHTML =
      FORM +
      `
      <form><label for="location">Location</label>
        <select id="location"><option value="">Select</option><option>California</option><option>New York</option></select>
      </form>`;
    // Keep the extra control in the form found by the generic adapter.
    document.querySelector('form')!.append(document.querySelector('#location')!);
    const changed = vi.fn();
    document.querySelector('form')!.addEventListener('change', changed);
    const fill = async (answers = ANSWERS, location = 'California') => {
      const scan = await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
      const fields = plan(scan, answers).filter((entry) => entry.answer?.type !== 'file');
      const select = scan.fields.find((field) => field.kind === 'select')!;
      const entry = fields.find((field) => field.fieldId === select.id)!;
      entry.answer = { type: 'choice', want: { kind: 'like', texts: [location] }, option: location };
      return ask<Record<string, { ok: boolean; value?: string }>>({ type: 'frame:fill', fields });
    };
    await fill();
    expect(changed).toHaveBeenCalledTimes(6);
    changed.mockClear();
    const repeated = await fill();
    expect(changed).not.toHaveBeenCalled();
    expect(Object.values(repeated).every((result) => result.ok)).toBe(true);

    await fill({ ...ANSWERS, email: 'another@example.com' }, 'New York');
    expect(changed).toHaveBeenCalledTimes(2);
    expect(input('email').value).toBe('another@example.com');
    expect(document.querySelector<HTMLSelectElement>('#location')!.value).toBe('New York');
    changed.mockClear();
    input('phone').value = '';
    await fill({ ...ANSWERS, email: 'another@example.com' }, 'New York');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(input('phone').value).toBe(ANSWERS.phone);
  });

  const ESSAY = `
    <form>
      <label for="name">Full name</label><input id="name">
      <label for="email">Email</label><input id="email" type="email">
      <label for="resume">Resume</label><input id="resume" type="file">
      <label for="why">Why do you want to work here?</label><textarea id="why"></textarea>
    </form>`;
  const essay = () => document.querySelector<HTMLTextAreaElement>('#why')!;
  /** The plan a service worker would send: the name by rule, the resume chosen, and what AI drafted. */
  const entries = (scan: FrameScan, draft: string | null, resumeId = 'res-1'): PlannedField[] =>
    scan.fields.flatMap((field): PlannedField[] => {
      const base = { fieldId: field.id, note: null, critical: false };
      if (field.kind === 'file')
        return [
          { ...base, status: 'filled', answer: { type: 'file', resumeId }, source: 'rule', key: 'resume' },
        ];
      if (field.kind === 'textarea')
        return draft === null
          ? []
          : [
              {
                ...base,
                status: 'draft',
                answer: { type: 'text', text: draft },
                source: 'ai',
                key: 'text.why',
              },
            ];
      if (field.label === 'Full name')
        return [
          {
            ...base,
            status: 'filled',
            answer: { type: 'text', text: 'Alex Chen' },
            source: 'rule',
            key: 'name',
          },
        ];
      return [];
    });
  const read = (ask: ReturnType<typeof start>) =>
    ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
  const why = (scan: FrameScan) => scan.fields.find((field) => field.kind === 'textarea')!;

  it('keeps what AI wrote, and says so, until the owner changes or empties it', async () => {
    const ask = start();
    document.body.innerHTML = ESSAY;
    await ask({ type: 'frame:fill', fields: entries(await read(ask), 'First draft.') });
    expect(essay().value).toBe('First draft.');

    // Read again: the name is this script's own to redo, the draft is AI's and stays.
    const again = await read(ask);
    expect(again.fields.find((field) => field.label === 'Full name')?.filled).toBe(false);
    expect(why(again)).toMatchObject({ filled: true, drafted: true });
    // Were another draft sent all the same, the first would stand.
    const results = await ask<Record<string, { ok: boolean; value?: string }>>({
      type: 'frame:fill',
      fields: entries(again, 'Second draft.'),
    });
    expect(essay().value).toBe('First draft.');
    expect(results[why(again).id]).toMatchObject({ ok: true, value: 'First draft.' });

    // The owner rewrites it: theirs now, like any answer they put in.
    essay().value = 'My own words.';
    const edited = await read(ask);
    expect(why(edited).filled).toBe(true);
    expect(why(edited).drafted).toBeUndefined();

    // The owner empties it: open again, and what AI writes next goes in.
    essay().value = '';
    const emptied = await read(ask);
    expect(why(emptied).filled).toBe(false);
    await ask({ type: 'frame:fill', fields: entries(emptied, 'Second draft.') });
    expect(essay().value).toBe('Second draft.');
  });

  it('attaches the resume once, and again only when another is chosen or the upload is emptied', async () => {
    const ask = start();
    document.body.innerHTML = ESSAY;
    let attached = 0;
    input('resume').addEventListener('change', () => attached++);
    const fill = async (resumeId: string) => {
      const scan = await read(ask);
      const results = await ask<Record<string, { ok: boolean; value?: string }>>({
        type: 'frame:fill',
        fields: entries(scan, null, resumeId),
      });
      return results[scan.fields.find((field) => field.kind === 'file')!.id];
    };

    expect(await fill('res-1')).toMatchObject({ ok: true, value: 'Alex_Chen_Resume.pdf' });
    expect(attached).toBe(1);
    // The same resume again: it's there already, and says so.
    expect(await fill('res-1')).toMatchObject({ ok: true, value: 'Alex_Chen_Resume.pdf' });
    expect(attached).toBe(1);
    // Another one chosen on the card.
    await fill('res-2');
    expect(attached).toBe(2);
    // The owner takes the file out: the upload is empty, and is filled like any empty field.
    input('resume').value = '';
    await fill('res-2');
    expect(attached).toBe(3);
  });
});

describe('while filling', () => {
  it('brings each field it fills into view, and not the ones it leaves alone', async () => {
    const ask = start();
    document.body.innerHTML = FORM;
    input('org').value = 'Acme AI Labs';
    const seen: string[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      seen.push(this.id || this.querySelector('input')?.id || this.tagName);
    });

    const scan = await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
    await ask({ type: 'frame:fill', fields: plan(scan, ANSWERS) });

    // In the form's order; the resume, attached first, and the company the page already held don't move the page.
    expect(seen).toEqual(['name', 'email', 'phone', 'linkedin']);
  });
});

describe('filling a multi-select again', () => {
  // Greenhouse's "How do you identify? (race/ethnicity)": react-select with chips, the chosen option gone from the list.
  const OPTIONS = ['East Asian', 'South Asian', 'White'];
  const MULTI = `
    <form>
      <label for="email">Email</label><input id="email" type="email">
      <label for="resume">Resume</label><input id="resume" type="file">
      <label id="race-label" for="race">How do you identify?</label>
      <div class="select-shell"><div><div class="select__control"><div class="select__value-container">
        <input id="race" role="combobox" aria-labelledby="race-label"></div></div></div></div>
    </form>`;

  it('keeps its first pick instead of adding the nearest option left', async () => {
    const ask = start();
    document.body.innerHTML = MULTI;
    const shell = document.querySelector<HTMLElement>('.select-shell')!;
    const chips = () =>
      [...shell.querySelectorAll('.select__multi-value__label')].map((chip) => chip.textContent);
    shell.querySelector('.select__control')!.addEventListener('mouseup', () => {
      shell.querySelector('.select__menu')?.remove();
      const left = OPTIONS.filter((text) => !chips().includes(text));
      const menu = document.createElement('div');
      menu.className = 'select__menu';
      menu.innerHTML = `<div role="listbox">${left.map((text) => `<div role="option">${text}</div>`).join('')}</div>`;
      menu.addEventListener('click', (event) => {
        shell
          .querySelector('.select__value-container')!
          .insertAdjacentHTML(
            'afterbegin',
            `<div class="select__multi-value"><div class="select__multi-value__label">${(event.target as Element).textContent}</div></div>`,
          );
        menu.remove();
      });
      shell.append(menu);
    });

    const fill = async () => {
      const scan = await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
      const race = scan.fields.find((field) => field.label === 'How do you identify?')!;
      const results = await ask<Record<string, { ok: boolean; value?: string }>>({
        type: 'frame:fill',
        fields: [
          {
            fieldId: race.id,
            status: 'filled',
            answer: { type: 'choice', want: { kind: 'eeo', field: 'race', value: 'asian' }, option: null },
            source: 'rule',
            key: 'eeo.race',
            note: null,
            critical: false,
          },
        ],
      });
      return results[race.id];
    };

    expect(await fill()).toMatchObject({ ok: true, value: 'East Asian' });
    expect(await fill()).toMatchObject({ ok: true, value: 'East Asian' });
    expect(chips()).toEqual(['East Asian']);
  });
});

describe('what the form holds, told as it changes', () => {
  /** What the service worker was told the form holds, oldest first. */
  const told = () =>
    vi
      .mocked(fakeBrowser.runtime.sendMessage)
      .mock.calls.map(([message]) => message as unknown as { type: string } & FrameHeld)
      .filter((message) => message.type === 'frame:held');
  const type = (id: string, text: string) => {
    input(id).value = text;
    input(id).dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('follows the owner filling in a field by hand, and emptying it again', async () => {
    const ask = start();
    document.body.innerHTML = FORM;
    const scan = await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
    const id = (label: string) => scan.fields.find((field) => field.label === label)!.id;

    // The form as it was found, a moment after it was read. An upload with no file to see is left unsaid.
    await vi.waitFor(() => expect(told()).toHaveLength(1));
    expect(told()[0]?.fields[id('Phone')]).toEqual({ filled: false });
    expect(told()[0]?.fields).not.toHaveProperty(id('Resume'));

    type('phone', '+1 408 555 0100');
    await vi.waitFor(() => expect(told()).toHaveLength(2));
    expect(told()[1]?.fields[id('Phone')]).toEqual({ filled: true, value: '+1 408 555 0100' });

    type('phone', '');
    await vi.waitFor(() => expect(told()).toHaveLength(3));
    expect(told()[2]?.fields[id('Phone')]).toEqual({ filled: false });
  });

  it('looks again once a fill is through, later than the fill says it left each field', async () => {
    const ask = start();
    document.body.innerHTML = FORM;
    const scan = await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
    const email = scan.fields.find((field) => field.label === 'Email')!.id;
    const results = await ask<Record<string, { ok: boolean; at?: number }>>({
      type: 'frame:fill',
      fields: plan(scan, ANSWERS),
    });

    await vi.waitFor(() =>
      expect(told().at(-1)?.fields[email]).toEqual({ filled: true, value: 'alex@example.com', ours: true }),
    );
    // Nothing was told of the form half filled.
    expect(told()).toHaveLength(1);
    const { at } = told()[0]!;
    for (const result of Object.values(results)) expect(result.at).toBeLessThanOrEqual(at);
  });
});

describe('a form sent, and the page saying at once that it went through', () => {
  it('tells of the confirmation once the sending has been taken in, at the address it was seen at', async () => {
    start();
    document.body.innerHTML = FORM;
    // The service worker takes a while over the sending: it may have been asleep.
    let taken = () => {};
    const told: string[] = [];
    vi.mocked(fakeBrowser.runtime.sendMessage).mockImplementation(((message: {
      type: string;
      url?: string;
    }) => {
      told.push(message.url ? `${message.type} ${message.url}` : message.type);
      return message.type === 'submit:attempt'
        ? new Promise<void>((resolve) => (taken = resolve))
        : Promise.resolve();
    }) as never);

    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const here = location.href;
    document.body.innerHTML = '<main><h1>Thank you for applying.</h1></main>';
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(told.filter((type) => type.startsWith('submit:'))).toEqual(['submit:attempt']);

    taken();
    await vi.waitFor(() =>
      expect(told.filter((type) => type.startsWith('submit:'))).toEqual([
        'submit:attempt',
        `submit:confirmed ${here}`,
      ]),
    );
  });
});

describe('a page the browser translates after it was read', () => {
  const VOLUNTARY = FORM.replace(
    '</form>',
    `<fieldset>
    <legend>Veteran Status</legend>
    <input type="radio" name="veteran" id="v0"><label for="v0">I am a protected veteran</label>
    <input type="radio" name="veteran" id="v1"><label for="v1">I am not a protected veteran</label>
  </fieldset>
</form>`,
  );
  const NOT = 'I am not a protected veteran';

  afterEach(() => {
    document.documentElement.className = '';
  });

  it('has its form marked as not for translating, as it is read', async () => {
    const ask = start();
    document.body.innerHTML = VOLUNTARY;
    expect(document.querySelector('form')?.hasAttribute('translate')).toBe(false);
    await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
    expect(document.querySelector('form')?.getAttribute('translate')).toBe('no');
  });

  it('is read, filled and told of in the page’s own words', async () => {
    const ask = start();
    document.body.innerHTML = VOLUNTARY;
    const words = (scan: FrameScan) => scan.fields.map(({ label, options }) => ({ label, options }));
    const before = await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
    expect(words(before)).toContainEqual({ label: 'Full name', options: [] });
    expect(words(before)).toContainEqual({
      label: 'Veteran Status',
      options: ['I am a protected veteran', NOT],
    });

    // Chrome's translation: its mark on the document, and its words in two <font>s where the page's stood.
    document.documentElement.classList.add('translated-ltr');
    for (const [selector, text] of [
      ['label[for="name"]', '姓名'],
      ['legend', '退伍军人身份'],
      ['label[for="v0"]', '我是受保护的退伍军人'],
      ['label[for="v1"]', '我不是受保护的退伍军人'],
    ] as const)
      document.querySelector(selector)!.innerHTML = `<font><font>${text}</font></font>`;

    // Read again, as a fill starts by doing: the rules get the words they know.
    const scan = await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
    expect(words(scan)).toEqual(words(before));
    const veteran = scan.fields.find((field) => field.label === 'Veteran Status')!;
    const results = await ask<Record<string, { ok: boolean; value?: string }>>({
      type: 'frame:fill',
      fields: [
        {
          fieldId: veteran.id,
          status: 'filled',
          answer: { type: 'choice', want: { kind: 'eeo', field: 'veteran', value: 'not' }, option: NOT },
          source: 'rule',
          key: 'eeo.veteran',
          note: null,
          critical: false,
        },
      ] satisfies PlannedField[],
    });
    // The answer goes into the control it was planned for, which reads otherwise now.
    expect(input('v1').checked).toBe(true);
    expect(results[veteran.id]).toEqual(
      expect.objectContaining({ ok: true, value: '我不是受保护的退伍军人' }),
    );
    // And what the form holds is remembered in the page's words, not the translation's.
    expect(await ask({ type: 'frame:read', fieldIds: [veteran.id] })).toEqual([
      { fieldId: veteran.id, answer: { type: 'choice', want: { kind: 'like', texts: [NOT] }, option: NOT } },
    ]);
  });
});
