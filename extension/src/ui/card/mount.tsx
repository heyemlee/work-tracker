import { createRoot, type Root } from 'react-dom/client';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { Card } from './Card';
import './card.css';

/** Puts the card in the page's top frame, in a shadow root pinned to the bottom-right corner. */
export async function mountCard(ctx: ContentScriptContext, startOpen: boolean): Promise<void> {
  const ui = await createShadowRootUi<Root>(ctx, {
    name: 'outbox-autofill',
    position: 'inline',
    anchor: 'body',
    append: 'last',
    // Keystrokes typed into the card stay in the card; the page's shortcuts don't fire.
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
  ui.mount();
}
