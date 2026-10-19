import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { CardState, ChecklistItem } from '../messages';
import { buttonLook, forgetButton, resetButton, showOnButton } from './icon';

const item = (required: boolean, value: string | null): ChecklistItem =>
  ({ fieldId: 'f', label: 'F', status: value ? 'filled' : 'missing', value, required }) as ChecklistItem;

const state = (change: Partial<CardState> = {}): CardState =>
  ({ phase: 'idle', checklist: [], logged: null, error: null, ...change }) as CardState;

const filled = [item(true, 'Alex'), item(true, 'Chen'), item(false, null)];
const left = [item(true, 'Alex'), item(true, null)];

describe('what the toolbar button shows', () => {
  it('hops dots while the extension reads, fills or AI writes', () => {
    for (const phase of ['reading', 'filling', 'drafting'] as const)
      expect(buttonLook(undefined, state({ phase }))).toEqual({ moving: 'think', badge: false });
  });

  it('hops for joy when a fill ends with every required field filled', () => {
    expect(buttonLook({ working: true, logged: false }, state({ phase: 'done', checklist: filled }))).toEqual(
      {
        moving: 'happy',
        badge: false,
      },
    );
  });

  it('keeps still with a dot when the fill left required fields empty', () => {
    expect(buttonLook({ working: true, logged: false }, state({ phase: 'done', checklist: left }))).toEqual({
      moving: null,
      badge: true,
    });
  });

  it('hops when an application is logged, not when a tab it was logged on is first seen', () => {
    const logged = state({ logged: { result: {}, undone: false, manual: false } as CardState['logged'] });
    expect(buttonLook({ working: false, logged: false }, logged).moving).toBe('happy');
    expect(buttonLook(undefined, logged).moving).toBeNull();
    expect(buttonLook({ working: false, logged: true }, logged).moving).toBeNull();
  });

  it('shows a dot for an error the card shows, none for a log queued for later', () => {
    expect(buttonLook(undefined, state({ error: 'rejected' })).badge).toBe(true);
    expect(buttonLook(undefined, state({ error: 'queued' })).badge).toBe(false);
  });

  it('is still, with no dot, on a page with nothing to do', () => {
    expect(buttonLook(undefined, state())).toEqual({ moving: null, badge: false });
  });
});

describe('the toolbar button’s picture', () => {
  const setIcon = vi.fn(async (details: unknown) => details);

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(fakeBrowser.action, { setIcon });
    // A canvas that draws nothing: what's checked is which pictures go to the button, and when.
    const context = new Proxy(
      {},
      { get: (_, name) => (name === 'getImageData' ? () => ({ name: 'frame' }) : () => undefined) },
    );
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext = () => context;
      },
    );
    vi.stubGlobal('Path2D', class {});
  });

  afterEach(() => {
    forgetButton(5);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setIcon.mockClear();
  });

  it('moves only while the extension works on the tab, then goes back to the plain icon', () => {
    showOnButton(5, state({ phase: 'filling' }));
    vi.advanceTimersByTime(1000);
    const moving = setIcon.mock.calls.length;
    expect(moving).toBeGreaterThan(10);
    expect(setIcon.mock.calls.every(([details]) => (details as { tabId: number }).tabId === 5)).toBe(true);

    showOnButton(5, state({ phase: 'done', checklist: filled }));
    vi.advanceTimersByTime(1900);
    const hopping = setIcon.mock.calls.length;
    expect(hopping).toBeGreaterThan(moving + 15);
    vi.advanceTimersByTime(200);
    expect(setIcon).toHaveBeenLastCalledWith({ tabId: 5, path: { 16: 'icon/16.png', 32: 'icon/32.png' } });
    // And then nothing more: a still button costs nothing.
    const after = setIcon.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    expect(setIcon.mock.calls.length).toBe(after);
  });

  it('keeps a dot on the still picture while fields wait on the owner', () => {
    showOnButton(5, state({ phase: 'filling' }));
    showOnButton(5, state({ phase: 'done', checklist: left }));
    const last = setIcon.mock.calls.at(-1)?.[0] as { imageData?: unknown };
    expect(last.imageData).toBeDefined();
    const after = setIcon.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(setIcon.mock.calls.length).toBe(after);
  });

  it('goes back to the plain icon when the tab loads another page, and still hops for a log there', () => {
    showOnButton(5, state({ phase: 'done', checklist: left, error: 'rejected' }));
    resetButton(5);
    expect(setIcon).toHaveBeenLastCalledWith({ tabId: 5, path: { 16: 'icon/16.png', 32: 'icon/32.png' } });
    setIcon.mockClear();
    showOnButton(5, state({ logged: { result: {}, undone: false, manual: false } as CardState['logged'] }));
    vi.advanceTimersByTime(500);
    expect(setIcon.mock.calls.length).toBeGreaterThan(4);
  });

  it('draws nothing where there is no canvas', () => {
    vi.unstubAllGlobals();
    showOnButton(5, state({ phase: 'filling' }));
    vi.advanceTimersByTime(1000);
    expect(setIcon).not.toHaveBeenCalled();
  });
});
