import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../../test/fixtures';
import { extractFields } from '../extract';
import { formSnapshot } from '../snapshot';
import { lever } from './lever';

/**
 * The notes beside Lever's resume button, as its page has them: all hidden until its script shows one. Returns a way
 * to show one and hide another, as that script does.
 */
function notes(showing: string[] = []) {
  document.body.innerHTML = ['working', 'success', 'failure', 'oversize']
    .map((note) => `<span class="resume-upload-${note}" style="display: none"></span>`)
    .join('');
  const set = (note: string, shown: boolean) => {
    document.querySelector<HTMLElement>(`.resume-upload-${note}`)!.style.display = shown ? 'inline' : 'none';
  };
  for (const note of showing) set(note, true);
  return set;
}

describe('once the resume is attached to a Lever form', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** How long the fill waits before it goes on, in ms. */
  async function waited() {
    const started = Date.now();
    const waiting = lever.resumeRead!(document).then(() => Date.now() - started);
    await vi.runAllTimersAsync();
    return waiting;
  }

  it('goes on when Lever has read it, soon or late', async () => {
    for (const ms of [400, 4000]) {
      const set = notes(['working']);
      setTimeout(() => {
        set('working', false);
        set('success', true);
      }, ms);
      const took = await waited();
      expect(took).toBeGreaterThanOrEqual(ms);
      expect(took).toBeLessThanOrEqual(ms + 50);
    }
  });

  it('goes on when Lever says it couldn’t read it', async () => {
    const set = notes(['working']);
    setTimeout(() => {
      set('working', false);
      set('failure', true);
    }, 300);
    expect(await waited()).toBeLessThanOrEqual(350);
  });

  it('waits no longer than eight seconds for a read that never ends', async () => {
    notes(['working']);
    expect(await waited()).toBe(8000);
  });

  it('waits as it always did on a page that says nothing of reading', async () => {
    notes();
    expect(await waited()).toBe(2500);
    document.body.innerHTML = '';
    expect(await waited()).toBe(2500);
  });
});

// What "This page didn't fill right" saves of a Lever page. Lever's form is plain controls, whose answers a copy
// of the markup doesn't hold, but for two things its scripts write into the page: the resume's name, and the pick
// of a list it draws with select2 (the school). Both are drawn here as on Lever's own page, served from this
// machine (2026-10-08). A report reads the page's long lists (countries, universities): two or three seconds a
// report here, twice that on CI's machines, past the default five.
describe('a fill report of a Lever page', { timeout: 30_000 }, () => {
  const url = 'https://jobs.lever.co/wealthfront/93383267-2d57-45d0-bb6a-7d9c5d8b6f3c/apply';
  const report = (doc: Document) => formSnapshot(lever, doc, extractFields(lever, doc, 0), [])!;

  /** The page once Lever's scripts have run: select2 drawn over the list of schools, showing `pick` or its prompt. */
  function page(pick: string | null): Document {
    const doc = loadFixture('lever/wealthfront.html', url);
    const list = doc.querySelector<HTMLSelectElement>('select[data-qa="university-dropdown"]')!;
    list.classList.add('select2-hidden-accessible');
    list.insertAdjacentHTML(
      'afterend',
      '<span class="select2 select2-container select2-container--default" dir="ltr" style="width: 100%;">' +
        '<span class="selection"><span class="select2-selection select2-selection--single" role="combobox"' +
        ` aria-haspopup="true" aria-expanded="false" tabindex="0" aria-labelledby="select2-${list.id}-container">` +
        (pick
          ? `<span class="select2-selection__rendered" id="select2-${list.id}-container" title="${pick}">${pick}</span>`
          : `<span class="select2-selection__rendered" id="select2-${list.id}-container">` +
            '<span class="select2-selection__placeholder">Select a university or college</span></span>') +
        '<span class="select2-selection__arrow" role="presentation"><b role="presentation"></b></span></span></span>' +
        '<span class="dropdown-wrapper" aria-hidden="true"></span></span>',
    );
    if (pick) list.value = pick;
    return doc;
  }

  it('names neither the school picked nor the resume attached', () => {
    const doc = page('Santa Clara University');
    // The resume's name, as Lever's script writes it beside the button.
    const upload = doc.querySelector('.visible-resume-upload')!;
    upload.classList.add('has-file');
    upload.querySelector('.filename')!.textContent = 'Alex_Chen_Resume.pdf';
    const name = doc.querySelector<HTMLInputElement>('input[name="name"]')!;
    name.value = 'Alex Chen';

    const { html } = report(doc);
    for (const text of ['Alex_Chen', 'Alex Chen']) expect(html.includes(text)).toBe(false);
    const saved = document.implementation.createHTMLDocument('');
    saved.body.innerHTML = html;
    const shown = saved.querySelector('.select2-selection__rendered')!;
    expect(shown.textContent).toBe('');
    expect(shown.hasAttribute('title')).toBe(false);
    // The school is still named once, as every school is: among the list's own choices.
    const named = (text: string) => text.split('Santa Clara University').length - 1;
    expect(named(html)).toBe(named(report(page(null)).html));
  });

  it('keeps the prompt of a list nothing was picked from', () => {
    const saved = document.implementation.createHTMLDocument('');
    saved.body.innerHTML = report(page(null)).html;
    expect(saved.querySelector('.select2-selection__rendered')?.textContent).toBe(
      'Select a university or college',
    );
  });
});
