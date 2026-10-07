import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from './dom';

describe('waiting for the page', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** When the page was looked at, in ms from the start, while waiting `timeout` ms for something that never comes. */
  async function looks(timeout: number, interval?: number, soon?: boolean) {
    const started = Date.now();
    const at: number[] = [];
    const waiting = waitFor(() => void at.push(Date.now() - started), timeout, interval, soon);
    await vi.runAllTimersAsync();
    expect(await waiting).toBeNull();
    return at;
  }

  it('looks at its pace, and for no longer than asked', async () => {
    expect(await looks(150)).toEqual([0, 50, 100, 150]);
    expect(await looks(170, 100)).toEqual([0, 100, 170]);
  });

  it('told the answer comes soon, looks again at once and less often from there', async () => {
    expect(await looks(150, 50, true)).toEqual([0, 10, 30, 70, 120, 150]);
    expect(await looks(400, 100, true)).toEqual([0, 10, 30, 70, 150, 250, 350, 400]);
  });

  it('answers as soon as it has looked and found something', async () => {
    for (const [soon, after] of [
      [true, 30],
      [false, 50],
    ] as const) {
      let ready = false;
      setTimeout(() => (ready = true), 25);
      const started = Date.now();
      const waiting = waitFor(() => (ready ? 'here' : null), 2000, 50, soon);
      await vi.runAllTimersAsync();
      expect(await waiting).toBe('here');
      expect(Date.now() - started).toBe(after);
    }
  });
});
