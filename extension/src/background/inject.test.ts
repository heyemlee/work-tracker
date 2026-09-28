import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

const toFrame = vi.fn();
vi.mock('../messages', async (original) => ({
  ...(await original<typeof import('../messages')>()),
  toFrame,
}));

const { openCard, showForm } = await import('./inject');

/** A tab's frames and which of them run the content script; records what the service worker injects. */
function tab(frames: number[], running: number[]) {
  const runs = new Set(running);
  const injected: number[][] = [];
  vi.spyOn(fakeBrowser.scripting, 'executeScript').mockImplementation((async (injection: {
    target: { allFrames?: boolean; frameIds?: number[] };
    files?: string[];
  }) => {
    const ids = injection.target.allFrames ? frames : (injection.target.frameIds ?? []);
    if (injection.files) {
      injected.push(ids);
      for (const id of ids) runs.add(id);
      return ids.map((frameId) => ({ frameId, documentId: '', result: undefined }));
    }
    return ids.map((frameId) => ({ frameId, documentId: '', result: runs.has(frameId) }));
  }) as never);
  return injected;
}

describe('bringing in the card', () => {
  beforeEach(() => {
    toFrame.mockReset();
    toFrame.mockResolvedValue(true);
  });

  it('puts the script in the form frame, then the card in the top frame, which opens by itself', async () => {
    const injected = tab([0, 3], []);
    await showForm(1, 3);
    expect(injected).toEqual([[3], [0]]);
    expect(toFrame).not.toHaveBeenCalled();
  });

  it('opens the card that is there without injecting anything: that would stop it', async () => {
    const injected = tab([0, 3], [0, 3]);
    await showForm(2, 3);
    expect(injected).toEqual([]);
    expect(toFrame).toHaveBeenCalledWith(2, 0, 'card:open', {});
  });

  it('brings in one card when two frames show forms at once', async () => {
    const injected = tab([0, 3, 5], [3, 5]);
    await Promise.all([showForm(3, 3), showForm(3, 5)]);
    expect(injected).toEqual([[0]]);
    expect(toFrame).toHaveBeenCalledTimes(1);
  });

  it('puts the script in every frame that lacks it when the toolbar button is pressed', async () => {
    const injected = tab([0, 2, 4], [2]);
    await openCard(4);
    expect(injected).toEqual([[4], [0]]);
  });
});
