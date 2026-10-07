import type { QuickAddResult } from '@domain/repository';
import type { Snapshot } from '@domain/types';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FrameScan, PlannedField, Posting, ScannedField } from '../model';
import type { FormSnapshot } from '../storage';
import { makeProfile } from '../test/profiles';

const loadSnapshot = vi.fn<() => Promise<Snapshot>>();
const syncProfile = vi.fn<() => Promise<null>>(async () => null);
const quickAddOrQueue = vi.fn();
const undoQuickAdd = vi.fn();
vi.mock('./outbox', () => ({
  loadSnapshot,
  quickAddOrQueue,
  undoQuickAdd,
  syncProfile,
  OutboxSignedOut: class extends Error {},
}));

// The page, for the tests that fill: what a frame holds, and what it takes.
const scanFrames = vi.fn<typeof import('./frames').scanFrames>();
const fillFrames = vi.fn<typeof import('./frames').fillFrames>();
vi.mock('./frames', async (original) => ({
  ...(await original<typeof import('./frames')>()),
  scanFrames,
  fillFrames,
}));

const { cardState, fill, logApplication, saveJob, snapshot, undo } = await import('./card');
const { updateSession } = await import('./session');
const { DEFAULT_SETTINGS, loggedItem, profileItem, settingsItem, snapshotsItem } = await import('../storage');

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

describe('the checklist', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.clearAllMocks();
    loadSnapshot.mockResolvedValue(empty);
  });

  const scanned = (id: string, label: string, required: boolean): ScannedField => ({
    id,
    label,
    description: '',
    kind: 'text',
    options: [],
    required,
    hint: null,
    section: '',
    entry: null,
    filled: false,
    maxLength: null,
  });
  const planned = (fieldId: string, status: PlannedField['status'], text?: string): PlannedField => ({
    fieldId,
    status,
    answer: text ? { type: 'text', text } : null,
    source: text ? 'rule' : null,
    key: null,
    note: null,
    critical: false,
  });

  it('lists every field, what needs the owner first, and says which the form requires', async () => {
    const session = await updateSession(TAB, URL_, () => ({
      hasForm: true,
      fields: [
        scanned('0:first', 'First Name', true),
        scanned('0:twitter', 'Twitter URL', false),
        scanned('0:gpa', 'GPA', true),
        scanned('0:phone', 'Phone', true),
      ],
      plan: [
        planned('0:first', 'filled', 'Alex'),
        planned('0:twitter', 'skipped'),
        planned('0:gpa', 'missing'),
        planned('0:phone', 'filled', '+1 408-555-0100'),
      ],
      // The page refused the phone number: it's the owner's to fill.
      results: { '0:first': { ok: true, value: 'Alex' }, '0:phone': { ok: false, error: 'no such option' } },
    }));
    const { checklist } = await cardState(session);
    expect(
      checklist.map(({ label, status, required, value }) => ({ label, status, required, value })),
    ).toEqual([
      { label: 'GPA', status: 'missing', required: true, value: null },
      { label: 'Phone', status: 'missing', required: true, value: null },
      { label: 'First Name', status: 'filled', required: true, value: 'Alex' },
      { label: 'Twitter URL', status: 'skipped', required: false, value: null },
    ]);
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

describe('filling', () => {
  const field = (id: string, label: string, more: Partial<ScannedField> = {}): ScannedField => ({
    id,
    label,
    description: '',
    kind: 'text',
    options: [],
    required: true,
    hint: null,
    section: '',
    entry: null,
    filled: false,
    maxLength: null,
    ...more,
  });
  /** What reading the tab finds: one frame, holding a form with these questions. */
  const form = (fields: ScannedField[]): FrameScan[] => [
    { frameId: 0, ats: 'greenhouse', isApplication: true, posting, fields, step: null },
  ];
  /** An answer that comes when the test says so. */
  function later<T>() {
    let settle!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
      settle = resolve;
    });
    return { promise, settle };
  }
  // A tab of its own for each test: a tab's session outlives the storage a test starts from.
  let tab = 100;

  beforeEach(async () => {
    fakeBrowser.reset();
    vi.clearAllMocks();
    tab++;
    loadSnapshot.mockResolvedValue(empty);
    syncProfile.mockResolvedValue(null);
    // The page takes whatever it's given.
    fillFrames.mockImplementation(async (_tab, plan) =>
      Object.fromEntries(plan.filter((entry) => entry.answer).map((entry) => [entry.fieldId, { ok: true }])),
    );
    await profileItem.setValue(makeProfile());
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, aiEnabled: false });
  });

  it('asks Outbox for the profile and the accounts together, and only once', async () => {
    const profile = later<null>();
    const accounts = later<Snapshot>();
    syncProfile.mockReturnValue(profile.promise);
    loadSnapshot.mockReturnValue(accounts.promise);
    scanFrames.mockResolvedValue(form([field('0:first', 'First Name')]));

    const filling = fill(tab, URL_);
    // Neither has answered yet, and both have been asked.
    await vi.waitFor(() => {
      expect(syncProfile).toHaveBeenCalledTimes(1);
      expect(loadSnapshot).toHaveBeenCalledTimes(1);
    });
    profile.settle(null);
    accounts.settle(empty);

    const state = await filling;
    expect(state.phase).toBe('done');
    expect(fillFrames).toHaveBeenCalledWith(tab, [
      expect.objectContaining({ fieldId: '0:first', answer: { type: 'text', text: 'Alex' } }),
    ]);
    // The card heard of each stage on the way, and none of that went back to Outbox.
    expect(loadSnapshot).toHaveBeenCalledTimes(1);
  });
});
