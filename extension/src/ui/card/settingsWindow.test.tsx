import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { toBackground } from '../../messages';
import { showSettings } from './settingsWindow';

// What's in the window asks the service worker for a ticket and frames the extension's page; here only the window
// matters, and that it can be closed.
let close: (() => void) | undefined;
vi.mock('./SettingsFrame', () => ({
  SettingsFrame: ({ onClose }: { onClose: () => void }) => {
    close = onClose;
    return <div className="sheet">Settings</div>;
  },
}));
vi.mock('../../messages', async (original) => ({
  ...(await original<typeof import('../../messages')>()),
  toBackground: vi.fn(async () => undefined),
}));

// The page the window was put on goes away: WXT takes the window with it.
let leave: (() => void) | undefined;
const ctx = {
  onInvalidated: (remove: () => void) => {
    leave = remove;
  },
} as unknown as ContentScriptContext;
const hosts = () => document.querySelectorAll('outbox-autofill');

afterEach(() => {
  leave?.();
  close = undefined;
  vi.restoreAllMocks();
  vi.mocked(toBackground).mockClear();
});

describe('showSettings', () => {
  it('puts one window over the page however often it’s asked for, and takes it away as it closes', async () => {
    const shown = showSettings(ctx);
    expect(showSettings(ctx)).toBe(shown);
    await vi.waitFor(() => expect(close).toBeDefined());
    expect(hosts()).toHaveLength(1);
    // Closed to the page, as the card is.
    expect(hosts()[0]!.shadowRoot).toBeNull();
    expect(toBackground).not.toHaveBeenCalled();

    close!();
    await shown;
    expect(hosts()).toHaveLength(0);

    // Closed, it opens again.
    close = undefined;
    const again = showSettings(ctx);
    expect(again).not.toBe(shown);
    await vi.waitFor(() => expect(close).toBeDefined());
    expect(hosts()).toHaveLength(1);
    close!();
    await again;
  });

  it('opens the settings in their tab where the page defined the card’s element first', async () => {
    // As in mount.test.tsx: happy-dom knows no `:defined`.
    vi.spyOn(Element.prototype, 'matches').mockImplementation((selector) => selector === ':defined');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await showSettings(ctx);
    expect(hosts()).toHaveLength(0);
    expect(toBackground).toHaveBeenCalledWith('card:options', {});
  });
});
