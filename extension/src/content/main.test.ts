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
      input('email').value = 'alex.chen@gmail.com';
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
      expect(told().at(-1)?.fields[email]).toEqual({ filled: true, value: 'alex@example.com' }),
    );
    // Nothing was told of the form half filled.
    expect(told()).toHaveLength(1);
    const { at } = told()[0]!;
    for (const result of Object.values(results)) expect(result.at).toBeLessThanOrEqual(at);
  });
});
