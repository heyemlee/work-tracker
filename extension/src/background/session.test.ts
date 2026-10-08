import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

const TAB = 7;
const URL_ = 'https://job-boards.greenhouse.io/arcadia/jobs/42';
const SENT = '2026-10-08T12:00:00.000Z';

/** The service worker as it wakes: nothing of any tab in its memory, and what it had stored of them still there. */
async function woken() {
  vi.resetModules();
  return import('./session');
}

describe('a tab’s session, on a service worker just woken', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    const { updateSession } = await woken();
    await updateSession(TAB, URL_, () => ({ ats: 'greenhouse', accountId: 'a1' }));
  });

  it('is read from what was stored of it', async () => {
    const { getSession } = await woken();
    expect(await getSession(TAB)).toMatchObject({ ats: 'greenhouse', accountId: 'a1', submittedAt: null });
    expect(await getSession(TAB + 1)).toBeNull();
  });

  it('is the one a flow has just changed, for a flow that read it meanwhile', async () => {
    const { getSession, updateSession } = await woken();
    // A form is sent and the page confirms it at once: the two reach the worker one behind the other.
    const [, read] = await Promise.all([
      updateSession(TAB, URL_, () => ({ submittedAt: SENT })),
      getSession(TAB),
    ]);
    expect(read).toMatchObject({ accountId: 'a1', submittedAt: SENT });
    // And the stored copy that was read before the change hasn't taken the changed one's place.
    expect(await getSession(TAB)).toMatchObject({ submittedAt: SENT });
    expect(await (await woken()).getSession(TAB)).toMatchObject({ accountId: 'a1', submittedAt: SENT });
  });
});
