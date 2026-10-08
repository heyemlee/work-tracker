import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planForm } from '../plan';
import { loadFixture } from '../test/fixtures';
import { makeProfile } from '../test/profiles';
import { greenhouse } from './adapters/greenhouse';
import type { Handle } from './adapters/types';
import { applyAnswer, readAnswer } from './apply';
import { extractFields } from './extract';

const noFile = async () => null;

function html(markup: string): void {
  document.body.innerHTML = markup;
}

const $ = <T extends Element>(selector: string) => document.querySelector(selector) as T;
const $$ = <T extends Element>(selector: string) => [...document.querySelectorAll(selector)] as T[];

describe('applyAnswer', () => {
  beforeEach(() => html(''));

  it('types text so input listeners see it', async () => {
    html('<input id="name">');
    const input = $<HTMLInputElement>('#name');
    const seen: string[] = [];
    input.addEventListener('input', () => seen.push(input.value));
    const result = await applyAnswer(
      { type: 'input', element: input },
      { type: 'text', text: 'Alex Chen' },
      noFile,
    );
    expect(result).toEqual({ ok: true, value: 'Alex Chen' });
    expect(seen).toEqual(['Alex Chen']);
  });

  it('respects a text field’s maximum length', async () => {
    html('<input id="short" maxlength="5">');
    const input = $<HTMLInputElement>('#short');
    await applyAnswer(
      { type: 'input', element: input },
      { type: 'text', text: 'Too long an answer' },
      noFile,
    );
    expect(input.value).toBe('Too l');
  });

  it('picks a select option by what the plan wants', async () => {
    html(
      '<select id="s"><option value="">Select…</option><option value="1">Yes</option><option value="2">No</option></select>',
    );
    const select = $<HTMLSelectElement>('#s');
    const result = await applyAnswer(
      { type: 'select', element: select },
      { type: 'choice', want: { kind: 'no' }, option: null },
      noFile,
    );
    expect(result.ok).toBe(true);
    expect(select.value).toBe('2');
  });

  it('checks the radio whose label answers', async () => {
    html(
      '<label><input type="radio" name="q" value="a">Yes, I live here</label><label><input type="radio" name="q" value="b">Yes, I plan to relocate</label>',
    );
    const inputs = $$<HTMLInputElement>('input');
    const handle: Handle = { type: 'radio', inputs };
    await applyAnswer(
      handle,
      { type: 'choice', want: { kind: 'like', texts: ['Yes, I plan to relocate'] }, option: null },
      noFile,
    );
    expect(inputs[1]?.checked).toBe(true);
    expect(readAnswer(handle)).toMatchObject({ type: 'choice', option: 'Yes, I plan to relocate' });
  });

  it('presses the matching yes/no button', async () => {
    html('<button data-option="yes">Yes</button><button data-option="no">No</button>');
    const buttons = $$<HTMLButtonElement>('button');
    for (const button of buttons)
      button.addEventListener('click', () => button.setAttribute('aria-pressed', 'true'));
    await applyAnswer(
      { type: 'buttons', buttons },
      { type: 'choice', want: { kind: 'yes' }, option: 'Yes' },
      noFile,
    );
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1]?.getAttribute('aria-pressed')).toBeNull();
  });

  it('checks the boxes a multi-select answer names, and clears the rest', async () => {
    html(
      '<label><input type="checkbox" checked>Glassdoor</label><label><input type="checkbox">LinkedIn</label><label><input type="checkbox">English (ENG)</label>',
    );
    const inputs = $$<HTMLInputElement>('input');
    await applyAnswer({ type: 'multi', inputs }, { type: 'choices', texts: ['LinkedIn', 'English'] }, noFile);
    expect(inputs.map((input) => input.checked)).toEqual([false, true, true]);
  });

  it('ticks a lone box for a yes, never for other text', async () => {
    html('<input type="checkbox" id="box">');
    const element = $<HTMLInputElement>('#box');
    await applyAnswer({ type: 'checkbox', element }, { type: 'text', text: 'Alex Chen' }, noFile);
    expect(element.checked).toBe(false);
    await applyAnswer({ type: 'checkbox', element }, { type: 'text', text: 'Yes' }, noFile);
    expect(element.checked).toBe(true);
  });

  it('writes a date into separate month and year boxes', async () => {
    html('<input id="m"><input id="y">');
    const month = $<HTMLInputElement>('#m');
    const year = $<HTMLInputElement>('#y');
    await applyAnswer(
      { type: 'dateParts', month, day: null, year },
      { type: 'date', iso: '2025-06-01' },
      noFile,
    );
    expect([month.value, year.value]).toEqual(['06', '2025']);
  });

  it('formats dates for a text field that asks for MM/YYYY', async () => {
    html('<input id="d" placeholder="MM/YYYY">');
    const input = $<HTMLInputElement>('#d');
    await applyAnswer({ type: 'input', element: input }, { type: 'date', iso: '2025-06-01' }, noFile);
    expect(input.value).toBe('06/2025');
  });

  /**
   * An upload whose page says what it holds, as Gem's does: it names a file a moment after its input takes one,
   * if it takes it.
   */
  function namedUpload(takes: boolean) {
    html('<input id="resume" type="file"><p id="held">Earlier.pdf</p>');
    const input = $<HTMLInputElement>('#resume');
    const held = $<HTMLElement>('#held');
    input.addEventListener('change', () => {
      const name = input.files?.[0]?.name ?? '';
      if (takes) setTimeout(() => (held.textContent = name), 20);
    });
    const handle: Handle = { type: 'file', element: input, shown: () => held.textContent || null };
    return { input, held, handle };
  }
  const resume = async () => new File(['%PDF-1.4'], 'Alex_Chen_Resume.pdf', { type: 'application/pdf' });

  it('attaches a file where the input says what the upload holds, without waiting on the page', async () => {
    const { input, held } = namedUpload(false);
    const result = await applyAnswer(
      { type: 'file', element: input },
      { type: 'file', resumeId: 'res-1' },
      resume,
    );
    expect(result).toEqual({ ok: true, value: 'Alex_Chen_Resume.pdf' });
    expect(input.files?.[0]?.name).toBe('Alex_Chen_Resume.pdf');
    expect(held.textContent).toBe('Earlier.pdf');
  });

  it('counts a file as attached once the page shows it, where the page says what its upload holds', async () => {
    // The page shows the file it held before until it has taken the new one in.
    const { held, handle } = namedUpload(true);
    const result = await applyAnswer(handle, { type: 'file', resumeId: 'res-1' }, resume);
    expect(result).toEqual({ ok: true, value: 'Alex_Chen_Resume.pdf' });
    expect(held.textContent).toBe('Alex_Chen_Resume.pdf');
  });

  it('says so when such a page doesn’t come to show the file', async () => {
    vi.useFakeTimers();
    try {
      const { input, handle } = namedUpload(false);
      const pending = applyAnswer(handle, { type: 'file', resumeId: 'res-1' }, resume);
      await vi.advanceTimersByTimeAsync(2500);
      expect(await pending).toEqual({ ok: false, error: 'the page did not take the file' });
      // The input holds the file all the same, which is why it isn't asked.
      expect(input.files?.[0]?.name).toBe('Alex_Chen_Resume.pdf');
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Greenhouse's city search as its react-select draws it: no list until something is typed, then suggestions
   * beside the control; a pick shows beside the input, which empties. Above it, the phone widget's country list,
   * hidden by a stylesheet the test doesn't load.
   */
  function citySearch(suggestions: string[]): HTMLInputElement {
    html(`
      <div class="iti__dropdown-content iti__hide"><ul role="listbox">
        <li role="option">Afghanistan+93</li><li role="option">United States+1</li></ul></div>
      <div class="select-shell"><div><div class="select__control"><div class="select__value-container">
        <div class="select__input-container"><input id="candidate-location" role="combobox" type="text"></div>
      </div></div></div></div>`);
    const input = $<HTMLInputElement>('#candidate-location');
    const shell = $<HTMLElement>('.select-shell');
    input.addEventListener('input', () => {
      shell.querySelector('.select__menu')?.remove();
      if (!input.value) return;
      shell.insertAdjacentHTML(
        'beforeend',
        `<div class="select__menu"><div role="listbox">${suggestions
          .map((text) => `<div class="select__option" role="option">${text}</div>`)
          .join('')}</div></div>`,
      );
      for (const option of shell.querySelectorAll<HTMLElement>('.select__option')) {
        option.addEventListener('click', () => {
          input.insertAdjacentHTML(
            'beforebegin',
            `<div class="select__single-value">${option.textContent}</div>`,
          );
          input.value = '';
          shell.querySelector('.select__menu')?.remove();
        });
      }
    });
    return input;
  }

  it('picks a searched city by its state, not the first namesake or another field’s list', async () => {
    const input = citySearch([
      'Santa Clara, Villa Clara, Cuba',
      'Santa Clara, California, United States',
      'Santa Clara, Utah, United States',
    ]);
    const result = await applyAnswer(
      { type: 'typeahead', element: input },
      { type: 'text', text: 'Santa Clara, CA' },
      noFile,
    );
    expect(result).toEqual({ ok: true, value: 'Santa Clara, California, United States' });
    expect($('.select__single-value').textContent).toBe('Santa Clara, California, United States');
  });

  it('empties a dropdown’s search box and says so when no suggestion fits', async () => {
    vi.useFakeTimers();
    try {
      const input = citySearch(['Springfield, Illinois, United States']);
      const pending = applyAnswer(
        { type: 'typeahead', element: input },
        { type: 'text', text: 'Santa Clara, CA' },
        noFile,
      );
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toEqual({ ok: false, error: 'no suggestion' });
      expect(input.value).toBe('');
      expect($('.select__single-value')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a choice the page doesn’t offer instead of guessing', async () => {
    html('<select id="s"><option>Red</option><option>Blue</option></select>');
    const result = await applyAnswer(
      { type: 'select', element: $<HTMLSelectElement>('#s') },
      { type: 'choice', want: { kind: 'yes' }, option: null },
      noFile,
    );
    expect(result).toEqual({ ok: false, error: 'no matching option' });
  });
});

// A page the browser translates between the reading and the fill, or while it's filled: each text gives way to
// the translation, in two nested <font>s, and the controls stay where they were.
describe('choices the page has worded anew since they were read', () => {
  beforeEach(() => html(''));

  /** Puts the translation where the text was, as Chrome's page translation does. */
  function translate(words: Record<string, string>): void {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    for (const text of texts) {
      const into = words[text.data.trim()];
      if (!into) continue;
      if (text.parentElement instanceof HTMLOptionElement) {
        text.data = into;
        continue;
      }
      const outer = document.createElement('font');
      const inner = document.createElement('font');
      inner.textContent = into;
      outer.append(inner);
      text.replaceWith(outer);
    }
  }

  const RACE = ['Hispanic or Latino', 'Asian (Not Hispanic or Latino)', 'Decline to self-identify'];
  const RACE_ZH = {
    [RACE[0]!]: '西班牙裔或拉丁裔',
    [RACE[1]!]: '亚裔（非西班牙裔或拉丁裔）',
    [RACE[2]!]: '拒绝自我识别',
  };
  const asian = {
    type: 'choice',
    want: { kind: 'eeo', field: 'race', value: 'asian' },
    option: RACE[1]!,
  } as const;

  it('checks the radio standing where the planned one was read', async () => {
    html(
      RACE.map(
        (text, at) => `<input type="radio" name="race" id="r${at}"><label for="r${at}">${text}</label>`,
      ).join(''),
    );
    const inputs = $$<HTMLInputElement>('input');
    const handle: Handle = { type: 'radio', inputs };
    translate(RACE_ZH);

    // Without the reading there is only the translation to go by, and none of it answers.
    expect(await applyAnswer(handle, asian, noFile)).toEqual({ ok: false, error: 'no matching option' });
    expect(await applyAnswer(handle, asian, noFile, RACE)).toEqual({
      ok: true,
      value: '亚裔（非西班牙裔或拉丁裔）',
    });
    expect(inputs.map((input) => input.checked)).toEqual([false, true, false]);
    // And what it holds is told in the words it was read in.
    expect(readAnswer(handle, RACE)).toMatchObject({ type: 'choice', option: RACE[1] });
    expect(readAnswer(handle)).toMatchObject({ type: 'choice', option: '亚裔（非西班牙裔或拉丁裔）' });
  });

  it('presses the button standing where the planned one was read', async () => {
    html('<button data-option="yes">Yes</button><button data-option="no">No</button>');
    const buttons = $$<HTMLButtonElement>('button');
    for (const button of buttons)
      button.addEventListener('click', () => button.setAttribute('aria-pressed', 'true'));
    const handle: Handle = { type: 'buttons', buttons };
    translate({ Yes: '是的', No: '不' });
    const result = await applyAnswer(handle, { type: 'choice', want: { kind: 'no' }, option: 'No' }, noFile, [
      'Yes',
      'No',
    ]);
    expect(result).toEqual({ ok: true, value: '不' });
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([null, 'true']);
    expect(readAnswer(handle, ['Yes', 'No'])).toMatchObject({ type: 'choice', option: 'No' });
  });

  it('picks from a list by place, past the prompt it starts with', async () => {
    html(
      '<select id="s"><option value="">Select...</option><option value="m">Male</option><option value="f">Female</option><option value="d">Decline to self-identify</option></select>',
    );
    const select = $<HTMLSelectElement>('#s');
    const handle: Handle = { type: 'select', element: select };
    const read = ['Male', 'Female', 'Decline to self-identify'];
    translate({
      'Select...': '选择...',
      Male: '男性',
      Female: '女性',
      'Decline to self-identify': '拒绝自我识别',
    });
    const female = {
      type: 'choice',
      want: { kind: 'eeo', field: 'gender', value: 'female' },
      option: 'Female',
    } as const;
    expect(await applyAnswer(handle, female, noFile, read)).toEqual({ ok: true, value: '女性' });
    expect(select.value).toBe('f');
  });

  it('ticks the boxes an answer names in the words they were read in', async () => {
    const read = ['English', 'Mandarin', 'Spanish'];
    html(read.map((text) => `<label><input type="checkbox">${text}</label>`).join(''));
    const inputs = $$<HTMLInputElement>('input');
    const handle: Handle = { type: 'multi', inputs };
    translate({ English: '英语', Mandarin: '普通话', Spanish: '西班牙语' });
    const result = await applyAnswer(
      handle,
      { type: 'choices', texts: ['English', 'Mandarin'] },
      noFile,
      read,
    );
    expect(result).toEqual({ ok: true, value: '英语, 普通话' });
    expect(inputs.map((input) => input.checked)).toEqual([true, true, false]);
    expect(readAnswer(handle, read)).toEqual({ type: 'choices', texts: ['English', 'Mandarin'] });
  });

  it('goes by what is there when the choices themselves have changed', async () => {
    // Read with three choices, and the page offers two others by now: no place of theirs is the planned one's.
    html('<label><input type="radio" name="q">Yes</label><label><input type="radio" name="q">No</label>');
    const inputs = $$<HTMLInputElement>('input');
    const handle: Handle = { type: 'radio', inputs };
    const planned = { type: 'choice', want: { kind: 'no' }, option: 'Not now' } as const;
    expect(await applyAnswer(handle, planned, noFile, ['Now', 'Later', 'Not now'])).toEqual({
      ok: true,
      value: 'No',
    });
    expect(inputs.map((input) => input.checked)).toEqual([false, true]);
  });
});

// Stripe's embedded form, as saved: "countries you anticipate working in" is a group of boxes that name countries
// in short ("UK", "US"), and the profile spells its country out.
describe('a saved page’s boxes', () => {
  const url = 'https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=8044460';

  it('ticks the applicant’s country among boxes that name it in short', async () => {
    const doc = loadFixture('greenhouse/stripe-embed.html', url);
    const { fields, handles } = extractFields(greenhouse, doc, 0);
    const field = fields.find((item) => /countries you anticipate working in/.test(item.label));
    expect(field).toMatchObject({ kind: 'multi', required: true });
    expect(field?.options.slice(-4)).toEqual(['The Netherlands', 'UAE', 'UK', 'US']);
    const [planned] = planForm(
      [field!],
      {
        profile: makeProfile(),
        email: 'alex@example.com',
        resumeId: null,
        posting: greenhouse.posting(doc, url),
        today: '2026-10-08',
        appliedBefore: false,
      },
      [],
    );
    expect(planned).toMatchObject({ status: 'filled', key: 'workCountries' });

    const handle = handles.get(field!.id);
    if (handle?.type !== 'multi') throw new Error('not a group of boxes');
    expect(await applyAnswer(handle, planned!.answer!, noFile)).toEqual({ ok: true, value: 'US' });
    const ticked = handle.inputs
      .filter((input) => input.checked)
      .map((input) => doc.querySelector(`label[for="${input.id}"]`)?.textContent);
    expect(ticked).toEqual(['US']);
    expect(readAnswer(handle)).toEqual({ type: 'choices', texts: ['US'] });
  });
});
