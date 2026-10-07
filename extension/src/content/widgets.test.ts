import { beforeEach, describe, expect, it } from 'vitest';
import { clickAway, pickFromCombobox, pickFromTypeahead } from './widgets';

const OPTIONS = ['United States Minor Outlying Islands (+1)', 'United States of America (+1)'];

/** A search box with its list. `stays` keeps the list open after a pick, as Workday's prompts do. */
function dropdown(stays: boolean) {
  document.body.innerHTML = `
    <input id="search" aria-controls="list">
    <div id="list" role="listbox">${OPTIONS.map((text) => `<div role="option">${text}</div>`).join('')}</div>`;
  const input = document.querySelector<HTMLInputElement>('#search')!;
  const list = document.querySelector<HTMLElement>('#list')!;
  const escapes: string[] = [];
  for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
    option.addEventListener('click', () => {
      input.dataset.picked = option.textContent ?? '';
      if (!stays) list.remove();
    });
  }
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    escapes.push(event.key);
    list.hidden = true;
  });
  input.focus();
  return { input, list, escapes };
}

const america = (texts: string[]) =>
  texts.find((text) => text.startsWith('United States of America')) ?? null;

describe('after picking from a dropdown', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('closes a list that stays open, as clicking away would', async () => {
    const { input, list, escapes } = dropdown(true);
    expect(await pickFromTypeahead(input, 'United States of America', america)).toBe(
      'United States of America (+1)',
    );
    expect(input.dataset.picked).toBe('United States of America (+1)');
    expect(escapes).toEqual(['Escape']);
    expect(list.hidden).toBe(true);
    expect(document.activeElement).not.toBe(input);
  });

  it('leaves alone a list that closed itself', async () => {
    const { input, escapes } = dropdown(false);
    expect(await pickFromCombobox(input, america)).toBe('United States of America (+1)');
    expect(escapes).toEqual([]);
  });
});

describe('searching a dropdown', () => {
  it('waits past what the list shows first for a suggestion that fits', async () => {
    // Greenhouse's school list shows its first page while the search runs.
    document.body.innerHTML = `
      <input id="search" aria-controls="list">
      <div id="list" role="listbox"><div role="option">Aalborg University</div></div>`;
    const input = document.querySelector<HTMLInputElement>('#search')!;
    const list = document.querySelector<HTMLElement>('#list')!;
    input.addEventListener('input', () =>
      setTimeout(() => (list.innerHTML = '<div role="option">Santa Clara University</div>'), 120),
    );
    const picked: string[] = [];
    list.addEventListener('click', (event) => picked.push((event.target as Element).textContent ?? ''));
    const school = (texts: string[]) => texts.find((text) => text === 'Santa Clara University') ?? null;
    expect(await pickFromTypeahead(input, 'Santa Clara University', school)).toBe('Santa Clara University');
    expect(picked).toEqual(['Santa Clara University']);
  });
});

describe('clicking away', () => {
  it('closes a Workday-style popup that listens for presses outside it, with no listbox role to spot', async () => {
    document.body.innerHTML = `
      <div id="prompt"><input id="search"></div>
      <div id="popup"><div data-automation-id="promptOption">United States of America (+1)</div></div>`;
    const input = document.querySelector<HTMLInputElement>('#search')!;
    const popup = document.querySelector<HTMLElement>('#popup')!;
    const option = popup.querySelector<HTMLElement>('[data-automation-id="promptOption"]')!;
    option.addEventListener('click', () => (input.dataset.picked = option.textContent ?? ''));
    // Workday closes its popups on a mousedown anywhere outside them.
    document.addEventListener('mousedown', (event) => {
      if (!popup.contains(event.target as Node)) popup.remove();
    });
    input.focus();
    clickAway(input);
    expect(document.querySelector('#popup')).toBeNull();
    expect(document.activeElement).not.toBe(input);
  });
});
