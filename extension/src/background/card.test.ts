import type { QuickAddResult } from '@domain/repository';
import type { Snapshot } from '@domain/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Posting } from '../model';

const loadSnapshot = vi.fn<() => Promise<Snapshot>>();
const quickAddOrQueue = vi.fn();
const undoQuickAdd = vi.fn();
vi.mock('./outbox', () => ({
  loadSnapshot,
  quickAddOrQueue,
  undoQuickAdd,
  syncProfile: vi.fn(async () => null),
  OutboxSignedOut: class extends Error {},
}));

const { logApplication, saveJob, undo } = await import('./card');
const { updateSession } = await import('./session');
const { loggedItem } = await import('../storage');

const URL_ = 'https://job-boards.greenhouse.io/arcadia/jobs/42';
const TAB = 7;
const posting: Posting = {
  ats: 'greenhouse',
  company: 'Arcadia Cloud',
  title: 'Agent Infrastructure Engineer',
  url: URL_,
  location: 'San Francisco, CA',
  description: '',
};
const saved: QuickAddResult = { jobId: 'j1', createdJobId: 'j1', createdCompanyId: 'c1', applicationIds: [] };

const T0 = '2026-09-28T12:00:00.000Z';
const empty: Snapshot = {
  accounts: [],
  resumes: [],
  channels: [],
  companies: [],
  jobs: [],
  applications: [],
};
const tracked = (applied: boolean): Snapshot => ({
  ...empty,
  accounts: [{ id: 'a1', label: 'A', email: 'me@example.com', color: 'blue', createdAt: T0 }],
  companies: [{ id: 'c1', name: 'Arcadia Cloud', createdAt: T0 }],
  jobs: [
    {
      id: 'j1',
      companyId: 'c1',
      title: 'Agent Infrastructure Engineer',
      url: URL_,
      notes: '',
      createdAt: T0,
      updatedAt: T0,
    },
  ],
  applications: applied
    ? [
        {
          id: 'p1',
          jobId: 'j1',
          accountId: 'a1',
          channelId: null,
          resumeId: null,
          stage: 'applied',
          rejected: false,
          appliedAt: '2026-09-28',
          source: 'user',
          createdAt: T0,
          updatedAt: T0,
        },
      ]
    : [],
});

describe('saving a posting for later', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    vi.clearAllMocks();
    loadSnapshot.mockResolvedValue(empty);
    quickAddOrQueue.mockResolvedValue(saved);
    await updateSession(TAB, URL_, () => ({ posting }));
  });

  it('adds a job with no applications, and takes it back on Undo', async () => {
    const state = await saveJob(TAB, URL_);
    expect(quickAddOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Arcadia Cloud',
        title: 'Agent Infrastructure Engineer',
        url: URL_,
        accountIds: [],
        channelId: null,
        resumeId: null,
      }),
    );
    expect(state.saved).toEqual({ result: saved, undone: false });

    const after = await undo(TAB, URL_);
    expect(undoQuickAdd).toHaveBeenCalledWith(saved);
    expect(after.saved?.undone).toBe(true);
  });

  it("doesn't save a posting Outbox already tracks, and says how far it got", async () => {
    loadSnapshot.mockResolvedValue(tracked(false));
    const state = await saveJob(TAB, URL_);
    expect(quickAddOrQueue).not.toHaveBeenCalled();
    expect(state.tracked).toBe('saved');

    loadSnapshot.mockResolvedValue(tracked(true));
    expect((await saveJob(TAB, URL_)).tracked).toBe('applied');
  });

  it('only counts a log with an account as the first application', async () => {
    await saveJob(TAB, URL_);
    expect(await loggedItem.getValue()).toBe(false);

    loadSnapshot.mockResolvedValue({ ...empty, accounts: tracked(false).accounts });
    quickAddOrQueue.mockResolvedValue({ ...saved, applicationIds: ['p1'] });
    await updateSession(TAB, URL_, () => ({ accountId: 'a1' }));
    await logApplication(TAB, URL_, true);
    expect(await loggedItem.getValue()).toBe(true);
  });
});
