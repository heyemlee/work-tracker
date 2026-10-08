import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Held } from '../model';
import { rebuildDocument } from '../test/rebuild';
import { greenhouse } from './adapters/greenhouse';
import type { Adapter, Handle } from './adapters/types';
import { workday } from './adapters/workday';
import { extractFields } from './extract';
import { heldBy, watchHeld } from './held';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The form's first field, as the content script reaches it. */
function field(markup: string, adapter: Adapter = greenhouse) {
  document.body.innerHTML = markup;
  const { fields, handles } = extractFields(adapter, document, 0);
  return handles.get(fields[0]!.id)!;
}

const form = (inner: string) => `<form id="application-form">${inner}</form>`;

/** One of Greenhouse's dropdowns, as its react-select draws it: empty, holding a pick, or being searched. */
const select = ({
  pick = '',
  has = pick !== '',
  id = 'question_1',
}: { pick?: string; has?: boolean; id?: string } = {}) =>
  form(`<div class="select"><div class="select__container">
    <label id="${id}-label" for="${id}" class="label select__label">What is your preferred office location?<span aria-hidden="true">*</span></label>
    <div class="select-shell"><div><div class="select__control">
      <div class="select__value-container${has ? ' select__value-container--has-value' : ''}">
        ${pick ? `<div class="select__single-value">${pick}</div>` : ''}
        <div class="select__input-container"><input class="select__input" id="${id}" type="text" role="combobox" aria-labelledby="${id}-label" aria-required="true"></div>
      </div></div></div></div></div></div>`);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('what a field holds', () => {
  it('reads a text box as it stands, and no more of a long answer than the list shows', () => {
    const name = field(form('<label for="a">First Name</label><input id="a">'));
    expect(heldBy(name)).toEqual({ filled: false });
    document.querySelector<HTMLInputElement>('#a')!.value = 'Alex';
    expect(heldBy(name)).toEqual({ filled: true, value: 'Alex' });
    document.querySelector<HTMLInputElement>('#a')!.value = 'word '.repeat(60);
    expect(heldBy(name)?.value).toHaveLength(121);
  });

  it('reads a native dropdown as empty while it shows its prompt', () => {
    const office = field(
      form(
        '<label for="s">Office</label><select id="s"><option value="">Select...</option><option>Menlo Park, CA</option></select>',
      ),
    );
    expect(heldBy(office)).toEqual({ filled: false });
    document.querySelector<HTMLSelectElement>('#s')!.value = 'Menlo Park, CA';
    // Which option, the browser tells through `selectedOptions`; the test DOM doesn't keep that up, and the spec
    // in e2e/greenhouse.spec.ts reads it in Chromium.
    expect(heldBy(office)).toMatchObject({ filled: true });
  });

  it('reads the pick Greenhouse’s dropdown shows beside its search box', () => {
    expect(heldBy(field(select()))).toEqual({ filled: false });
    expect(heldBy(field(select({ pick: 'Menlo Park, CA' })))).toEqual({
      filled: true,
      value: 'Menlo Park, CA',
    });
  });

  it('doesn’t take what is typed into a dropdown’s search box for a pick, nor lose the pick meanwhile', () => {
    // Nothing chosen yet, and the owner is typing to narrow the list.
    const searching = field(select());
    document.querySelector<HTMLInputElement>('#question_1')!.value = 'Menl';
    expect(heldBy(searching)).toEqual({ filled: false });
    // A pick is there, and react-select stops drawing it while something is typed over it.
    const again = field(select({ has: true }));
    document.querySelector<HTMLInputElement>('#question_1')!.value = 'New';
    expect(heldBy(again)).toEqual({ filled: true });
  });

  it('reads the city picked in Greenhouse’s search field, where the input itself stays empty', () => {
    const city = field(select({ pick: 'Santa Clara, California, United States', id: 'candidate-location' }));
    expect(city.type).toBe('typeahead');
    expect(heldBy(city)).toEqual({ filled: true, value: 'Santa Clara, California, United States' });
    const typed = field(select({ id: 'candidate-location' }));
    document.querySelector<HTMLInputElement>('#candidate-location')!.value = 'Santa';
    expect(heldBy(typed)).toEqual({ filled: false });
  });

  it('says of a box whether it’s ticked', () => {
    const consent = field(form('<label><input type="checkbox" id="c"> I agree</label>'));
    expect(heldBy(consent)).toEqual({ filled: false, value: 'unchecked' });
    document.querySelector<HTMLInputElement>('#c')!.checked = true;
    expect(heldBy(consent)).toEqual({ filled: true, value: 'checked' });
  });

  it('reads Workday’s dropdown by the value its button carries', () => {
    const page = (value: string, text: string) =>
      `<div data-automation-id="applyFlowPage"><div data-automation-id="formField-countryDropdown"><label>Country*</label><button aria-haspopup="listbox" value="${value}">${text}</button></div></div>`;
    expect(heldBy(field(page('', '选择一个'), workday))).toEqual({ filled: false });
    expect(heldBy(field(page('c7a1', 'United States of America'), workday))).toEqual({
      filled: true,
      value: 'United States of America',
    });
  });

  it('says nothing of an upload with no file to see: the page may have taken the file and emptied the input', () => {
    const resume = field(
      form('<div class="field"><label for="r">Resume</label><input id="r" type="file"></div>'),
    );
    expect(heldBy(resume)).toBeNull();
    document
      .querySelector('.field')!
      .insertAdjacentHTML('beforeend', '<span class="filename">Alex_Chen_Resume.pdf</span>');
    expect(heldBy(resume)).toEqual({ filled: true, value: 'Alex_Chen_Resume.pdf' });
  });

  it('says an upload is empty where the page itself tells what it holds and shows no file', () => {
    const resume = field(
      form('<div class="field"><label for="r">Resume</label><input id="r" type="file"></div>'),
    );
    if (resume.type !== 'file') throw new Error('not an upload');
    let shown: string | null = 'Alex_Chen_Resume.pdf';
    const read: Handle = { ...resume, shown: () => shown };
    expect(heldBy(read)).toEqual({ filled: true, value: 'Alex_Chen_Resume.pdf' });
    // Taken out again on the page: no file shown is no file held, and the list says so.
    shown = null;
    expect(heldBy(read)).toEqual({ filled: false });
  });

  it('says nothing of a widget that draws its value its own way and shows none', () => {
    const team = field(
      form('<label id="l">Team</label><div role="combobox" aria-labelledby="l">Choose…</div>'),
    );
    expect(team.type).toBe('combobox');
    expect(heldBy(team)).toBeNull();
    // Yes/no drawn as buttons, as Ashby's are: a pressed one is an answer, none pressed may only be unseen.
    document.body.innerHTML =
      '<button aria-pressed="false">Yes</button><button aria-pressed="false">No</button>';
    const buttons = [...document.querySelectorAll<HTMLElement>('button')];
    expect(heldBy({ type: 'buttons', buttons })).toBeNull();
    buttons[1]!.setAttribute('aria-pressed', 'true');
    expect(heldBy({ type: 'buttons', buttons })).toEqual({ filled: true, value: 'No' });
  });

  it('says nothing of a control the page has taken out', () => {
    const name = field(form('<label for="a">First Name</label><input id="a" value="Alex">'));
    expect(heldBy(name)).toEqual({ filled: true, value: 'Alex' });
    document.querySelector('#a')!.remove();
    expect(heldBy(name)).toBeNull();
  });
});

describe('watching what the form holds', () => {
  let stop = () => {};
  afterEach(() => stop());

  /** A page with one text box, and a watcher telling of it. */
  function watch() {
    document.body.innerHTML = form('<label for="a">First Name</label><input id="a">');
    const input = document.querySelector<HTMLInputElement>('#a')!;
    const told = vi.fn<(fields: Record<string, Held>) => void>();
    const watcher = watchHeld(
      document,
      () => ({ a: input.value ? { filled: true, value: input.value } : { filled: false } }),
      told,
      10,
    );
    stop = watcher.stop;
    const type = (text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    return { input, told, watcher, type };
  }

  it('tells what the owner typed a moment later, once for a burst of keys', async () => {
    const { told, type } = watch();
    type('A');
    type('Al');
    type('Alex');
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(1));
    expect(told).toHaveBeenLastCalledWith({ a: { filled: true, value: 'Alex' } });
    type('');
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(2));
    expect(told).toHaveBeenLastCalledWith({ a: { filled: false } });
  });

  it('tells of a pick that only redraws the page, as a custom dropdown’s does', async () => {
    const { input, told } = watch();
    // No event from the control: the page sets it and draws the pick.
    input.value = 'Menlo Park, CA';
    document.body.insertAdjacentHTML('beforeend', '<div class="select__single-value">Menlo Park, CA</div>');
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(1));
  });

  it('keeps quiet while the form holds what was last told', async () => {
    const { told, type } = watch();
    type('Alex');
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(1));
    document.body.append(document.createElement('p'));
    type('Alex');
    await pause(50);
    expect(told).toHaveBeenCalledTimes(1);
  });

  it('doesn’t look while the script itself fills, and looks again once it’s through', async () => {
    const { told, watcher, type } = watch();
    watcher.pause();
    type('Alex');
    await pause(50);
    expect(told).not.toHaveBeenCalled();
    watcher.resume();
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(1));
  });

  it('goes on looking at a page that throws its document away and builds another', async () => {
    const { input, told } = watch();
    rebuildDocument();
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(1));
    // A change in the new document, with no event from a control.
    input.value = 'Alex';
    document.body.append(document.createElement('p'));
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(2));
  });

  it('stops watching', async () => {
    const { told, watcher, type } = watch();
    watcher.stop();
    type('Alex');
    watcher.soon();
    await pause(50);
    expect(told).not.toHaveBeenCalled();
  });
});
