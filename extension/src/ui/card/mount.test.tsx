import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { mountCard } from './mount';

// The card itself talks to the service worker; here only where it's put matters.
vi.mock('./Card', () => ({ Card: () => <div className="card">Outbox</div> }));

// The page the card was put on goes away: WXT takes the card with it.
let leave: (() => void) | undefined;
const ctx = {
  onInvalidated: (remove: () => void) => {
    leave = remove;
  },
} as unknown as ContentScriptContext;
const host = () => document.querySelector('outbox-autofill');

afterEach(() => {
  leave?.();
  vi.restoreAllMocks();
});

describe('mountCard', () => {
  it('puts the card in a shadow root the page can’t open', async () => {
    await mountCard(ctx, true);
    expect(host()).not.toBeNull();
    expect(host()!.shadowRoot).toBeNull();
    expect(host()!.innerHTML).toBe('');
  });

  it('draws nothing where the page defined the card’s element first', async () => {
    // What a browser answers for an element the page has a definition for, which is handed the element's shadow
    // root, closed or not. happy-dom knows no `:defined`; the end-to-end specs ask Chromium (e2e/reach.spec.ts).
    vi.spyOn(Element.prototype, 'matches').mockImplementation((selector) => selector === ':defined');
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await mountCard(ctx, true);
    expect(host()).toBeNull();
    expect(warned).toHaveBeenCalledOnce();
  });
});
