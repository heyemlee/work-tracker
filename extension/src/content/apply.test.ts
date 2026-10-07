import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Handle } from './adapters/types';
import { applyAnswer, readAnswer } from './apply';

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
