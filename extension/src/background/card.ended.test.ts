import type { QuickAddResult } from '@domain/repository';
import type { Snapshot } from '@domain/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { CardState } from '../messages';
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

const { logApplication, readTab, saveJob, submitAttempt, submitConfirmed, undo } = await import('./card');
const { dropSession, getSession, updateSession } = await import('./session');

// Workday takes someone signed in from the last step of an application to their own home on the board, at another
// address. It has a heading of its own ("Welcome, Alex Chen") and is no posting: the content script reads none there.
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
const page = (read: Posting | null, more: Partial<FrameScan> = {}): FrameScan[] => [
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
const home = page(null);
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
  scanFrames.mockResolvedValue(home);
  await dropSession(TAB);
  // The card read the posting on its form's page, and the owner sent the form.
  await updateSession(TAB, APPLY, () => ({ url: APPLY, ats: 'workday', posting, accountId: 'a1' }));
  await submitAttempt(TAB, APPLY, [], []);
});

describe('the page an application ends on, at another address and no posting itself', () => {
  it('is the application’s: its posting stands there, with the log and its Undo', async () => {
    await submitConfirmed(TAB, ENDED);
    // The card comes up on that page and reads it.
    const state = await readTab(TAB, ENDED);

    expect(quickAddOrQueue).toHaveBeenCalledTimes(1);
    expect(quickAddOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Software Engineer', url: JOB }),
    );
    expect(state.posting).toMatchObject({ title: 'Software Engineer', url: JOB });
    expect(state.logged).toEqual({ result: added, undone: false, manual: false, accountId: 'a1' });
    expect(state.hasForm).toBe(false);
  });

  it('is read for the card once the log is through, however long Outbox takes over it', async () => {
    // The card comes up on the page while the log is on its way: read then, the tab would show the posting with
    // nothing logged, and the card would offer to log what is being logged.
    let answer: (result: QuickAddResult) => void = () => {};
    quickAddOrQueue.mockReturnValue(new Promise<QuickAddResult>((resolve) => (answer = resolve)));
    const logging = submitConfirmed(TAB, ENDED);
    let read: CardState | undefined;
    const reading = readTab(TAB, ENDED).then((state) => (read = state));
    await vi.waitFor(() => expect(quickAddOrQueue).toHaveBeenCalled());
    await new Promise((done) => setTimeout(done, 20));
    expect(read).toBeUndefined();
    expect(scanFrames).not.toHaveBeenCalled();

    answer(added);
    await logging;
    await reading;
    expect(read?.posting).toMatchObject({ title: 'Software Engineer', url: JOB });
    expect(read?.logged).toEqual({ result: added, undone: false, manual: false, accountId: 'a1' });
    const session = await getSession(TAB);
    expect(session?.logged).toEqual({ result: added, undone: false, manual: false, accountId: 'a1' });
  });

  it('goes on saying what went wrong with the log', async () => {
    // Outbox couldn't be reached: the log waits in the queue, and the card says so on the page it comes up on.
    quickAddOrQueue.mockResolvedValue(null);
    await submitConfirmed(TAB, ENDED);
    const state = await readTab(TAB, ENDED);
    expect(state.posting).toMatchObject({ title: 'Software Engineer', url: JOB });
    expect(state.logged).toBeNull();
    expect(state.error).toBe('queued');
  });

  it('is the application’s still when it goes on to another address without loading a page', async () => {
    await submitConfirmed(TAB, ENDED);
    await readTab(TAB, ENDED);
    // The board's own link to the candidate's home, from the page it shows that home on already.
    const moved = await readTab(TAB, `${BOARD}/userHome`, true);
    expect(moved.posting).toMatchObject({ title: 'Software Engineer', url: JOB });
    expect(moved.logged).toEqual({ result: added, undone: false, manual: false, accountId: 'a1' });
    // And read there again, as when the owner asks for the card.
    const again = await readTab(TAB, `${BOARD}/userHome`);
    expect(again.logged).toEqual({ result: added, undone: false, manual: false, accountId: 'a1' });
    // A posting reached the same way is that posting's.
    const next = { ...posting, title: 'Data Engineer', url: `${BOARD}/job/San-Jose-CA/Data-Engineer_R456` };
    scanFrames.mockResolvedValue(page(next));
    expect(await readTab(TAB, next.url, true)).toMatchObject({
      posting: { title: 'Data Engineer' },
      logged: null,
    });
  });

  it('is not at another address the tab loads', async () => {
    await submitConfirmed(TAB, ENDED);
    await readTab(TAB, ENDED);
    const state = await readTab(TAB, `${BOARD}/userHome`);
    expect(state.posting).toBeNull();
    expect(state.logged).toBeNull();
  });

  it('is no one’s where no application was seen to end there', async () => {
    // The owner opens their tasks without having sent anything a page confirmed.
    await updateSession(TAB, APPLY, () => ({ submittedAt: null }));
    await submitConfirmed(TAB, ENDED);
    const state = await readTab(TAB, ENDED);
    expect(quickAddOrQueue).not.toHaveBeenCalled();
    expect(state.posting).toBeNull();
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
    scanFrames.mockResolvedValue(home);
    expect((await readTab(TAB, ENDED)).posting).toBeNull();
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

describe('one log for each time a form is sent', () => {
  it('logs nothing more when the page that confirmed it is loaded again', async () => {
    await submitConfirmed(TAB, ENDED);
    await readTab(TAB, ENDED);
    await submitConfirmed(TAB, ENDED);
    expect(quickAddOrQueue).toHaveBeenCalledTimes(1);
  });

  it('leaves an Undo standing when that page is loaded again', async () => {
    await submitConfirmed(TAB, ENDED);
    await readTab(TAB, ENDED);
    await undo(TAB, ENDED);
    await submitConfirmed(TAB, ENDED);
    const state = await readTab(TAB, ENDED);
    expect(quickAddOrQueue).toHaveBeenCalledTimes(1);
    expect(state.logged).toEqual({ result: added, undone: true, manual: false, accountId: 'a1' });
  });

  it('queues it once, however often its page is loaded while Outbox is out of reach', async () => {
    quickAddOrQueue.mockResolvedValue(null);
    await submitConfirmed(TAB, ENDED);
    await readTab(TAB, ENDED);
    await submitConfirmed(TAB, ENDED);
    expect(quickAddOrQueue).toHaveBeenCalledTimes(1);
  });

  it('logs it once when two confirmations come in together', async () => {
    let done: (value: QuickAddResult) => void = () => undefined;
    quickAddOrQueue.mockReturnValueOnce(new Promise((resolve) => (done = resolve)));
    const first = submitConfirmed(TAB, ENDED);
    const second = submitConfirmed(TAB, ENDED);
    await new Promise((resolve) => setTimeout(resolve, 10));
    done(added);
    await Promise.all([first, second]);
    expect(quickAddOrQueue).toHaveBeenCalledTimes(1);
  });

  it('logs another account sending the same posting from the same tab', async () => {
    loadSnapshot.mockResolvedValue({
      ...outbox,
      accounts: [
        ...outbox.accounts,
        { id: 'a2', label: '', email: 'two@example.com', color: 'green', createdAt: T0 },
      ],
    });
    await submitAttempt(TAB, APPLY, [], ['one@example.com']);
    await submitConfirmed(TAB, ENDED);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await submitAttempt(TAB, APPLY, [], ['two@example.com']);
    await submitConfirmed(TAB, ENDED);
    expect(quickAddOrQueue).toHaveBeenCalledTimes(2);
    expect(quickAddOrQueue.mock.calls[1]?.[0]).toMatchObject({ accountIds: ['a2'] });
  });

  it('sends one log for a double press on the card', async () => {
    let done: (value: QuickAddResult) => void = () => undefined;
    quickAddOrQueue.mockReturnValueOnce(new Promise((resolve) => (done = resolve)));
    loadSnapshot.mockImplementation(async () =>
      quickAddOrQueue.mock.calls.length === 0
        ? outbox
        : {
            ...outbox,
            companies: [{ id: 'c1', name: 'Acme', createdAt: T0 }],
            jobs: [
              {
                id: 'j1',
                companyId: 'c1',
                title: 'Software Engineer',
                url: JOB,
                notes: '',
                createdAt: T0,
                updatedAt: T0,
              },
            ],
            applications: [
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
            ],
          },
    );
    scanFrames.mockResolvedValue(page(posting));
    await readTab(TAB, JOB);
    const first = logApplication(TAB, JOB, true);
    const second = logApplication(TAB, JOB, true);
    const saving = saveJob(TAB, JOB);
    await new Promise((resolve) => setTimeout(resolve, 10));
    done(added);
    await Promise.all([first, second, saving]);
    expect(quickAddOrQueue).toHaveBeenCalledTimes(1);
  });
});
