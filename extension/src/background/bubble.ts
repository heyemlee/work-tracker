import { browser } from 'wxt/browser';

/**
 * Where the browser lets no extension draw in the page (a new tab, its own settings, its store) no card can come up,
 * and the toolbar button did nothing at all there: broken, for all the owner could tell. On such a page the button
 * opens a small window of the browser's own under itself (entrypoints/bubble), which says why and offers what needs
 * no page: Outbox, and the settings.
 *
 * The window is the button's only for this one opening: a popup that stayed set would take the next press as well,
 * on whatever the tab shows by then.
 */
export async function showBubble(tabId: number): Promise<void> {
  await browser.action.setPopup({ tabId, popup: '/bubble.html' });
  try {
    await browser.action.openPopup();
  } catch {
    // A browser that opens no popup unasked, or a window out of focus: the button does nothing there, as before.
  } finally {
    await browser.action.setPopup({ tabId, popup: '' });
  }
}
