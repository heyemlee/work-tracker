import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { rebuildDocument } from '../../test/rebuild';
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
  leave = undefined;
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

  it('goes back into a page that throws its document away and builds another, the same card', async () => {
    await mountCard(ctx, true);
    const card = host();
    rebuildDocument();
    expect(host()).toBeNull();
    await vi.waitFor(() => expect(host()).toBe(card));
    expect(card!.parentElement).toBe(document.body);
    // And into a body the page puts in place of its own, as pages that swap bodies between their views do.
    document.body.replaceWith(document.createElement('body'));
    await vi.waitFor(() => expect(host()).toBe(card));
  });

  it('stays out of a page that takes it out every time', async () => {
    await mountCard(ctx, true);
    const card = host()!;
    let taken = 0;
    const page = new MutationObserver(() => {
      if (!card.isConnected) return;
      taken++;
      card.remove();
    });
    page.observe(document.body, { childList: true });
    card.remove();
    await vi.waitFor(() => expect(taken).toBe(5));
    await new Promise((resolve) => setTimeout(resolve, 50));
    page.disconnect();
    expect(taken).toBe(5);
    expect(host()).toBeNull();
  });

  it('stays out once the extension has taken it away', async () => {
    await mountCard(ctx, true);
    leave?.();
    expect(host()).toBeNull();
    rebuildDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host()).toBeNull();
  });
});
