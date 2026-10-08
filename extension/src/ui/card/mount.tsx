import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { Card } from './Card';
import { mountInShadow } from './shadow';

/**
 * Puts the card in the page's top frame, in a shadow root (shadow.tsx) pinned to the window's right edge, from the
 * top: under the toolbar button that brings it back, and clear of what pages keep at the bottom (their Submit, chat
 * bubbles, reCAPTCHA's badge).
 */
export async function mountCard(ctx: ContentScriptContext, startOpen: boolean): Promise<void> {
  await mountInShadow(ctx, () => <Card startOpen={startOpen} />);
}
