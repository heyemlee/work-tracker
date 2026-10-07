import { createRoot, type Root } from 'react-dom/client';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { Card } from './Card';
import './card.css';

/**
 * Puts the card in the page's top frame, in a shadow root pinned to the window's right edge, from the top: under
 * the toolbar button that brings it back, and clear of what pages keep at the bottom (their Submit, chat bubbles,
 * reCAPTCHA's badge).
 *
 * The root is closed, and made on the extension's side of the page, where the page's scripts can't have swapped
 * `attachShadow` for their own: the page can neither look into the card (the accounts, the profile in its window)
 * nor press anything in it. What it still learns is in docs/autofill.md ("What the page can reach").
 */
export async function mountCard(ctx: ContentScriptContext, startOpen: boolean): Promise<void> {
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
      root.render(
        <div className="root">
          <Card startOpen={startOpen} />
        </div>,
      );
      return root;
    },
    onRemove: (root) => root?.unmount(),
  });
  // An element's own definition is handed its shadow root, closed or not (`ElementInternals.shadowRoot`), and a page
  // that defined an element by the card's name before the card came is that definition: no card there.
  if (ui.shadowHost.matches(':defined')) {
    console.warn('[outbox] This page defines an element named outbox-autofill: no card here.');
    return;
  }
  ui.mount();
}
