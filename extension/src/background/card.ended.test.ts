import type { QuickAddResult } from '@domain/repository';
import type { Snapshot } from '@domain/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FrameScan, Posting } from '../model';

const loadSnapshot = vi.fn<() => Promise<Snapshot>>();
const quickAddOrQueue = vi.fn();
vi.mock('./outbox', () => ({
  loadSnapshot,
  quickAddOrQueue,
  undoQuickAdd: vi.fn(),
  syncProfile: vi.fn(async () => null),
  OutboxSignedOut: class extends Error {},
}));
const scanFrames = vi.fn<typeof import('./frames').scanFrames>();
vi.mock('./frames', async (original) => ({
  ...(await original<typeof import('./frames')>()),
  scanFrames,
}));

const { readTab, submitAttempt, submitConfirmed } = await import('./card');
const { dropSession, getSession, updateSession } = await import('./session');

// Workday takes someone signed in from the last step of an application to a page of their own tasks, at another
// address, which names no posting.
const BOARD = 'https://acme.wd5.myworkdayjobs.com/en-US/External';
const JOB = `${BOARD}/job/San-Jose-CA/Software-Engineer_R123`;
const APPLY = `${JOB}/apply/applyManually`;
const ENDED = `${BOARD}/jobTasks/completed/application`;
const TAB = 11;
const posting: Posting = {
  ats: 'workday',
  company: 'Acme',
  title: 'Software Engineer',
  url: JOB,
  location: null,
  description: '',
};
/** What the content script reads of a page that holds no form. */
const page = (read: Posting, more: Partial<FrameScan> = {}): FrameScan[] => [
  {
    frameId: 0,
    ats: 'workday',
    isApplication: false,
    applying: false,
    sends: false,
    jobLike: true,
    otherForm: false,
    fields: [],
    posting: read,
    step: null,
    ...more,
  },
];
const tasks = page({ ...posting, title: null, url: ENDED });
const added: QuickAddResult = {
  jobId: 'j1',
  createdJobId: 'j1',
  createdCompanyId: 'c1',
  applicationIds: ['p1'],
};
const T0 = '2026-09-28T12:00:00.000Z';
const outbox: Snapshot = {
  accounts: [{ id: 'a1', label: '', email: 'one@example.com', color: 'blue', createdAt: T0 }],
  resumes: [],
  channels: [],
  companies: [],
  jobs: [],
  applications: [],
};

beforeEach(async () => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  loadSnapshot.mockResolvedValue(outbox);
  quickAddOrQueue.mockResolvedValue(added);
  scanFrames.mockResolvedValue(tasks);
  await dropSession(TAB);
  // The card read the posting on its form's page, and the owner sent the form.
  await updateSession(TAB, APPLY, () => ({ url: APPLY, ats: 'workday', posting, accountId: 'a1' }));
  await submitAttempt(TAB, APPLY, [], []);
});

describe('the page an application ends on, at another address and naming no posting', () => {
  it('is the application’s: its posting stands there, with the log and its Undo', async () => {
    await submitConfirmed(TAB, ENDED);
    // The card comes up on that page and reads it.
    const state = await readTab(TAB, ENDED);

    expect(quickAddOrQueue).toHaveBeenCalledTimes(1);
    expect(quickAddOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Software Engineer', url: JOB }),
    );
    expect(state.posting).toMatchObject({ title: 'Software Engineer', url: JOB });
    expect(state.logged).toEqual({ result: added, undone: false, manual: false });
    expect(state.hasForm).toBe(false);
  });

  it('is so whichever is through first, the log or the card’s reading of the page', async () => {
    // Outbox takes its time over the log: the page is read meanwhile.
    let answer: (result: QuickAddResult) => void = () => {};
    quickAddOrQueue.mockReturnValue(new Promise<QuickAddResult>((resolve) => (answer = resolve)));
    const logging = submitConfirmed(TAB, ENDED);
    const read = await readTab(TAB, ENDED);
    expect(read.posting).toMatchObject({ title: 'Software Engineer', url: JOB });
    expect(read.logged).toBeNull();

    answer(added);
    await logging;
    const session = await getSession(TAB);
    expect(session?.posting).toMatchObject({ title: 'Software Engineer', url: JOB });
    expect(session?.logged).toEqual({ result: added, undone: false, manual: false });
  });

  it('is no one’s where no application was seen to end there', async () => {
    // The owner opens their tasks without having sent anything a page confirmed.
    await updateSession(TAB, APPLY, () => ({ submittedAt: null }));
    await submitConfirmed(TAB, ENDED);
    const state = await readTab(TAB, ENDED);
    expect(quickAddOrQueue).not.toHaveBeenCalled();
    expect(state.posting).toMatchObject({ title: null, url: ENDED });
    expect(state.logged).toBeNull();
  });

  it('gives way to the next posting the tab moves to', async () => {
    await submitConfirmed(TAB, ENDED);
    await readTab(TAB, ENDED);
    const next = { ...posting, title: 'Data Engineer', url: `${BOARD}/job/San-Jose-CA/Data-Engineer_R456` };
    scanFrames.mockResolvedValue(page(next));
    const state = await readTab(TAB, next.url);
    expect(state.posting).toMatchObject({ title: 'Data Engineer' });
    expect(state.logged).toBeNull();
    // And that page, opened again later, is no application's any more.
    scanFrames.mockResolvedValue(tasks);
    expect((await readTab(TAB, ENDED)).posting).toMatchObject({ title: null, url: ENDED });
  });
});

describe('a page of an application with nothing on it to fill', () => {
  it('is the application’s for the card all the same, and the one that sends it is told apart', async () => {
    // A step whose fields are still on their way.
    scanFrames.mockResolvedValue(page(posting, { applying: true }));
    expect(await readTab(TAB, APPLY)).toMatchObject({ hasForm: false, applying: true, sends: false });
    // Loaded afresh, the page hasn't drawn the job's title yet: an application's all the same, and so a job's.
    scanFrames.mockResolvedValue(page({ ...posting, title: null }, { applying: true }));
    await dropSession(TAB + 1);
    expect(await readTab(TAB + 1, APPLY)).toMatchObject({ applying: true, jobPage: true });
    scanFrames.mockResolvedValue(page({ ...posting, title: null }));
    expect(await readTab(TAB + 1, JOB)).toMatchObject({ applying: false, jobPage: false });
    // The review of the whole, with the button that sends it.
    scanFrames.mockResolvedValue(page(posting, { applying: true, sends: true }));
    expect(await readTab(TAB, APPLY)).toMatchObject({ hasForm: false, applying: true, sends: true });
    // Back on the posting, the tab is on no application.
    scanFrames.mockResolvedValue(page(posting));
    expect(await readTab(TAB, JOB)).toMatchObject({ hasForm: false, applying: false, sends: false });
  });
});
