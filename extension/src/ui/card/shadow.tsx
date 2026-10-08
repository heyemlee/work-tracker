import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import './card.css';

/**
 * Puts the extension's own markup in the page's top frame, in a shadow root: the card, or the settings' window
 * alone. `content` is handed what takes it out of the page again. False where nothing was put.
 *
 * The root is closed, and made on the extension's side of the page, where the page's scripts can't have swapped
 * `attachShadow` for their own: the page can neither look into the card (the accounts, the profile in its window)
 * nor press anything in it. What it still learns is in docs/autofill.md ("What the page can reach").
 *
 * And it stays in the page for as long as it's wanted there (`keepInPage`).
 */
export async function mountInShadow(
  ctx: ContentScriptContext,
  content: (remove: () => void) => ReactNode,
): Promise<boolean> {
  let leave = () => {};
  const ui = await createShadowRootUi<Root>(ctx, {
    name: 'outbox-autofill',
    // Open only in the build the end-to-end specs drive (wxt.e2e.config.ts): Playwright can't look into a closed one.
    mode: import.meta.env.E2E ? 'open' : 'closed',
    position: 'inline',
    anchor: 'body',
    append: 'last',
    // Keys typed into the card don't bubble on into the page, whose shortcuts stay quiet. A listener of the page's
    // that catches events on their way down still gets them.
    isolateEvents: true,
    onMount(container) {
      const root = createRoot(container);
      root.render(<div className="root">{content(() => ui.remove())}</div>);
      return root;
    },
    onRemove(root) {
      leave();
      root?.unmount();
    },
  });
  // An element's own definition is handed its shadow root, closed or not (`ElementInternals.shadowRoot`), and a page
  // that defined an element by the card's name before the card came is that definition: no card there.
  if (ui.shadowHost.matches(':defined')) {
    console.warn('[outbox] This page defines an element named outbox-autofill: no card here.');
    return false;
  }
  ui.mount();
  leave = keepInPage(ui.shadowHost);
  return true;
}

/** Taken out this soon after it was put back, this many times running, the host was taken out on purpose. */
const SOON = 1000;
const TRIES = 5;

/**
 * Puts the host back in the page when the page drops it along with its own markup. A page React draws over what its
 * server sent throws the whole document away, `<html>` and all, when the two don't match, and builds another: so
 * do Greenhouse's boards with a font of their own (Twitch's), a moment after the card has come, which then was gone
 * for good, the toolbar button finding the script still running. The host goes back as it is, with what it shows.
 * Returns a function that stops this, for when the extension itself takes the host out.
 */
function keepInPage(host: HTMLElement): () => void {
  let back = 0;
  let refused = 0;
  const observer = new MutationObserver(look);
  function look() {
    if (!host.isConnected && document.body) {
      refused = Date.now() - back < SOON ? refused + 1 : 0;
      if (refused === TRIES) {
        observer.disconnect();
        return;
      }
      back = Date.now();
      document.body.append(host);
    }
    // The host's parent and the two above it, whichever they are by now: any of them may be the one replaced.
    observer.disconnect();
    for (const node of [document, document.documentElement, document.body])
      if (node) observer.observe(node, { childList: true });
  }
  look();
  return () => observer.disconnect();
}
