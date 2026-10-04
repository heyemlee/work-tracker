import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { toBackground } from './messages';

describe('asking the service worker', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects, rather than throws, in a page the extension was reloaded under', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    const asked = toBackground('card:state', { refresh: true });
    await expect(asked).rejects.toThrow('Extension context invalidated.');
  });
});
