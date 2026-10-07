import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
