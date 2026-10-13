import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { showBubble } from './bubble';

const setPopup = vi.fn(async () => undefined);
const openPopup = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(fakeBrowser.action, { setPopup, openPopup });
});

describe('the button’s own window, where a page takes no card', () => {
  it('opens for this press, and leaves the next press to the card', async () => {
    await showBubble(7);
    expect(setPopup.mock.calls).toEqual([[{ tabId: 7, popup: '/bubble.html' }], [{ tabId: 7, popup: '' }]]);
    expect(openPopup).toHaveBeenCalledTimes(1);
    // Set for the tab before it's opened, and taken back after.
    expect(setPopup.mock.invocationCallOrder[0]).toBeLessThan(openPopup.mock.invocationCallOrder[0]!);
    expect(openPopup.mock.invocationCallOrder[0]).toBeLessThan(setPopup.mock.invocationCallOrder[1]!);
  });

  it('leaves no popup set where the browser opened none', async () => {
    openPopup.mockRejectedValueOnce(new Error('Could not find an active browser window.'));
    await expect(showBubble(7)).resolves.toBeUndefined();
    expect(setPopup).toHaveBeenLastCalledWith({ tabId: 7, popup: '' });
  });
});
