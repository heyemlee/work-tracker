import type { QuickAddResult } from '@domain/repository';
import type { Snapshot } from '@domain/types';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Posting, ScannedField } from '../model';
import type { FormSnapshot } from '../storage';

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

const { logApplication, saveJob, snapshot, undo } = await import('./card');
const { updateSession } = await import('./session');
const { loggedItem, snapshotsItem } = await import('../storage');

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

describe('"This page didn’t fill right"', () => {
  const field: ScannedField = {
    id: '0:first',
    label: 'First Name',
    description: '',
    kind: 'text',
    options: [],
    required: true,
    hint: null,
    section: '',
    entry: null,
    filled: false,
    maxLength: null,
  };
  /** What the form's frame answers: its structure, with these questions. */
  const form = (labels: string[], step: string | null = null): Omit<FormSnapshot, 'id' | 'at'> => ({
    ats: 'greenhouse',
    url: URL_,
    step,
    fields: labels.map((label) => ({
      label,
      kind: 'text',
      options: [],
      required: false,
      hint: null,
      section: '',
      status: null,
      key: null,
    })),
    html: '<form></form>',
  });
  // Typed loosely: to Chrome's types a message to a tab answers nothing.
  const frame = vi.spyOn(fakeBrowser.tabs, 'sendMessage') as unknown as MockInstance<() => Promise<unknown>>;
  const saved = async () =>
    (await snapshotsItem.getValue()).map((shot) => [shot.step, shot.fields.length] as const);

  beforeEach(async () => {
    fakeBrowser.reset();
    frame.mockReset();
    await updateSession(TAB, URL_, () => ({ fields: [field] }));
  });

  it('keeps one snapshot of a form, the newest, however often it’s pressed there', async () => {
    frame.mockResolvedValue(form(['First Name', 'Email']));
    expect(await snapshot(TAB)).toBe(1);
    const first = (await snapshotsItem.getValue())[0]?.id;
    expect(await snapshot(TAB)).toBe(1);
    const [again, ...rest] = await snapshotsItem.getValue();
    expect(rest).toEqual([]);
    expect(again?.id).not.toBe(first);
  });

  it('keeps forms apart by their questions and their step, newest first', async () => {
    frame.mockResolvedValue(form(['First Name', 'Email'], 'step 1 of 2'));
    await snapshot(TAB);
    // Another company's form at the same address: Greenhouse's embedded forms share one.
    frame.mockResolvedValue(form(['First Name', 'Email', 'Phone'], 'step 1 of 2'));
    await snapshot(TAB);
    frame.mockResolvedValue(form(['First Name', 'Email'], 'step 2 of 2'));
    await snapshot(TAB);
    expect(await saved()).toEqual([
      ['step 2 of 2', 2],
      ['step 1 of 2', 3],
      ['step 1 of 2', 2],
    ]);
  });

  it('saves nothing when the frame is gone', async () => {
    frame.mockRejectedValue(new Error('Could not establish connection.'));
    expect(await snapshot(TAB)).toBe(0);
    expect(await snapshotsItem.getValue()).toEqual([]);
  });
});
