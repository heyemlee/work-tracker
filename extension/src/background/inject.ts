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

async function bringInAndOpen(tabId: number, asked: boolean, frameIds?: number[]): Promise<void> {
  if (await bringIn(tabId, frameIds)) return;
  await toFrame(tabId, 0, 'card:open', { asked }).catch(() => undefined);
}

const turns = new Map<number, Promise<void>>();

/**
 * One flow per tab at a time: two frames showing forms at once must not both bring in the card. False where the
 * page took none: one extensions can't touch (the browser's own pages, its store) just gets no card.
 */
function inTurn(tabId: number, task: () => Promise<void>): Promise<boolean> {
  const taken = (turns.get(tabId) ?? Promise.resolve()).then(task).then(
    () => true,
    () => false,
  );
  turns.set(
    tabId,
    taken.then(() => undefined),
  );
  return taken;
}

/** A frame shows an application form: the content script in it, the card in the top frame, and the card open. */
export async function showForm(tabId: number, frameId: number): Promise<void> {
  await inTurn(tabId, () => bringInAndOpen(tabId, false, frameId === 0 ? [0] : [frameId, 0]));
}

/**
 * The toolbar button, on any page: the content script in every frame, and the card open. False where the page takes
 * no card, which the button then says itself (bubble.ts).
 */
export function openCard(tabId: number): Promise<boolean> {
  return inTurn(tabId, () => bringInAndOpen(tabId, true));
}

export function forgetTab(tabId: number): void {
  turns.delete(tabId);
}
