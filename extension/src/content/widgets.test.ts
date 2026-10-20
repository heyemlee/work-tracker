import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clickAway, pickFromCombobox, pickFromTypeahead, readComboboxOptions } from './widgets';

const OPTIONS = ['United States Minor Outlying Islands (+1)', 'United States of America (+1)'];

/**
 * A search box with its list. `stays` keeps the list open after a pick, as Workday's prompts do; otherwise it closes
 * `closesAfter` ms after the pick, at once by default. `reactSelect` puts the box in that library's control.
 */
function dropdown(stays: boolean, closesAfter = 0, reactSelect = false) {
  document.body.innerHTML = `
    <div class="${reactSelect ? 'select__control' : 'box'}"><input id="search" aria-controls="list"></div>
    <div id="list" role="listbox">${OPTIONS.map((text) => `<div role="option">${text}</div>`).join('')}</div>`;
  const input = document.querySelector<HTMLInputElement>('#search')!;
  const list = document.querySelector<HTMLElement>('#list')!;
  const escapes: string[] = [];
  for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
    option.addEventListener('click', () => {
      input.dataset.picked = option.textContent ?? '';
      if (stays) return;
      if (closesAfter) setTimeout(() => list.remove(), closesAfter);
      else list.remove();
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

  describe('by the clock', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Picks, and says whether the pick was over once `ms` had gone by. */
    async function overWithin(ms: number, input: HTMLInputElement) {
      let over = false;
      const picking = pickFromCombobox(input, america).then((choice) => {
        over = true;
        return choice;
      });
      await vi.advanceTimersByTimeAsync(ms);
      const inTime = over;
      await vi.runAllTimersAsync();
      expect(await picking).toBe('United States of America (+1)');
      return inTime;
    }

    it('goes on as soon as react-select’s list has closed, which it has by its next render', async () => {
      const { input, escapes } = dropdown(false, 5, true);
      expect(await overWithin(20, input)).toBe(true);
      expect(escapes).toEqual([]);
    });

    it('gives react-select’s list 150 ms to close before closing it itself', async () => {
      const slow = dropdown(false, 120, true);
      expect(await overWithin(100, slow.input)).toBe(false);
      expect(slow.escapes).toEqual([]);

      const stuck = dropdown(true, 0, true);
      expect(await overWithin(140, stuck.input)).toBe(false);
      expect(stuck.escapes).toEqual(['Escape']);
    });

    it('leaves any other widget the 150 ms it had, closed or not', async () => {
      const { input, escapes } = dropdown(false, 5);
      expect(await overWithin(140, input)).toBe(false);
      expect(escapes).toEqual([]);
    });
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

describe('typing into a dropdown', () => {
  it('ends on a keystroke, which is what opens Greenhouse’s list', async () => {
    // Its react-select is shown by the form's own state, set when a key comes up: text that only changes opens nothing.
    document.body.innerHTML = `
      <div class="select-shell"><div><div class="select__control">
        <input id="search" role="combobox"></div></div></div>`;
    const input = document.querySelector<HTMLInputElement>('#search')!;
    const shell = document.querySelector<HTMLElement>('.select-shell')!;
    input.addEventListener('keyup', (event) => {
      if (event.key === 'Escape' || !input.value) return;
      shell.insertAdjacentHTML(
        'beforeend',
        '<div class="select__menu"><div role="listbox"><div role="option">Santa Clara University</div></div></div>',
      );
    });
    const school = (texts: string[]) => texts.find((text) => text === 'Santa Clara University') ?? null;
    expect(await pickFromTypeahead(input, 'Santa Clara University', school)).toBe('Santa Clara University');
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

describe('a dropdown whose list is drawn apart from its button', () => {
  /**
   * Gem's: a button with no word of what it opens, and a menu put at the end of the page while it is open. The
   * voluntary questions' is a `menu` of menu items; a posting's own questions get a list box.
   */
  function gemDropdown(listbox: boolean) {
    document.body.innerHTML =
      '<div class="container-37"><div class="input-127"><div class="bodyImportant-47">Gender</div>' +
      '<button type="button"><div class="buttonContentContainer-131">Please select</div></button></div></div>';
    const button = document.querySelector<HTMLElement>('button')!;
    const close = () => document.querySelector('#floating-ui-portal')?.remove();
    button.addEventListener('click', () => {
      if (document.querySelector('#floating-ui-portal')) return close();
      const items = ['Male', 'Female', 'Decline to self-identify']
        .map((text) => `<li role="${listbox ? 'option' : 'menuitem'}"><div>${text}</div></li>`)
        .join('');
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="floating-ui-portal"><div data-floating-ui-portal=""><menu${listbox ? ' role="listbox"' : ''}>${items}</menu></div></div>`,
      );
      for (const item of document.querySelectorAll('#floating-ui-portal li'))
        item.addEventListener('click', () => {
          button.firstElementChild!.textContent = item.textContent;
          close();
        });
    });
    button.addEventListener('keydown', (event) => event.key === 'Escape' && close());
    return button;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  for (const listbox of [false, true]) {
    it(`picks from ${listbox ? 'a list box' : 'a menu'} at the end of the page`, async () => {
      const button = gemDropdown(listbox);
      expect(
        await pickFromCombobox(button, (texts) => texts.find((text) => /decline/i.test(text)) ?? null),
      ).toBe('Decline to self-identify');
      expect(button.textContent).toBe('Decline to self-identify');
      expect(document.querySelector('#floating-ui-portal')).toBeNull();
    });
  }

  it('reads the choices and closes the menu again', async () => {
    const button = gemDropdown(false);
    expect(await readComboboxOptions(button)).toEqual(['Male', 'Female', 'Decline to self-identify']);
    expect(document.querySelector('#floating-ui-portal')).toBeNull();
    expect(button.textContent).toBe('Please select');
  });
});

describe('a dropdown that names its list before drawing it', () => {
  // Eightfold's: each search box names its list from the start, draws it on a down arrow, and the last field's list
  // is still fading out when the next box is opened.
  it('waits for its own list, not the one still on the page', async () => {
    document.body.innerHTML = `
      <ul id="list-2" role="listbox"><li><button role="option">🇺🇸 (+1) United States of America</button></li></ul>
      <input id="country" role="combobox" aria-controls="list-5" aria-expanded="false">`;
    const input = document.querySelector<HTMLInputElement>('#country')!;
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return;
      setTimeout(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          '<ul id="list-5" role="listbox"><li><button role="option">阿富汗</button></li><li><button role="option">美国</button></li></ul>',
        );
        input.setAttribute('aria-expanded', 'true');
        for (const option of document.querySelectorAll('#list-5 [role="option"]'))
          option.addEventListener('click', () => {
            input.value = option.textContent!;
            document.querySelector('#list-5')!.remove();
          });
      }, 60);
    });
    expect(await pickFromCombobox(input, (texts) => texts.find((text) => text === '美国') ?? null)).toBe(
      '美国',
    );
    expect(input.value).toBe('美国');
  });
});
