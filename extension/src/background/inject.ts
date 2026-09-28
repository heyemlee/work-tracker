import { browser } from 'wxt/browser';
import { RUNNING_FLAG, toFrame } from '../messages';

/** Of these frames (every frame when none are named), the ones the content script doesn't run in yet. */
async function notRunning(tabId: number, frameIds?: number[]): Promise<number[]> {
  const results = await browser.scripting.executeScript({
    target: frameIds ? { tabId, frameIds } : { tabId, allFrames: true },
    func: (flag: string) => (window as unknown as Record<string, unknown>)[flag] === true,
    args: [RUNNING_FLAG],
  });
  return results.filter((result) => result.result !== true).map((result) => result.frameId);
}

/**
 * Brings the content script into the frames that don't run it yet, never twice into one: WXT stops a running copy,
 * card and all, when the same script starts again. The top frame goes last, since its card reads the other frames as
 * it opens. True when the top frame got a new card, which opens by itself.
 */
async function bringIn(tabId: number, frameIds?: number[]): Promise<boolean> {
  const missing = await notRunning(tabId, frameIds);
  const inject = (ids: number[]) =>
    browser.scripting.executeScript({
      target: { tabId, frameIds: ids },
      files: ['/content-scripts/inject.js'],
    });
  const others = missing.filter((frameId) => frameId !== 0);
  // A frame may have gone since it was checked; the others still get the script.
  if (others.length) await inject(others).catch(() => undefined);
  if (!missing.includes(0)) return false;
  await inject([0]);
  return true;
}

async function bringInAndOpen(tabId: number, frameIds?: number[]): Promise<void> {
  if (await bringIn(tabId, frameIds)) return;
  await toFrame(tabId, 0, 'card:open', {}).catch(() => undefined);
}

const turns = new Map<number, Promise<void>>();

/** One flow per tab at a time: two frames showing forms at once must not both bring in the card. */
function inTurn(tabId: number, task: () => Promise<void>): Promise<void> {
  // A page extensions can't touch (the Chrome Web Store, chrome:// pages) just gets no card.
  const turn = (turns.get(tabId) ?? Promise.resolve()).then(task).catch(() => undefined);
  turns.set(tabId, turn);
  return turn;
}

/** A frame shows an application form: the content script in it, the card in the top frame, and the card open. */
export function showForm(tabId: number, frameId: number): Promise<void> {
  return inTurn(tabId, () => bringInAndOpen(tabId, frameId === 0 ? [0] : [frameId, 0]));
}

/** The toolbar button, on any page: the content script in every frame, and the card open. */
export function openCard(tabId: number): Promise<void> {
  return inTurn(tabId, () => bringInAndOpen(tabId));
}

export function forgetTab(tabId: number): void {
  turns.delete(tabId);
}
