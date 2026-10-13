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

// The page and the model, for the tests that fill: what a frame holds, what it takes, what comes back drafted.
const scanFrames = vi.fn<typeof import('./frames').scanFrames>();
const fillFrames = vi.fn<typeof import('./frames').fillFrames>();
const asForm = vi.fn<typeof import('./frames').asForm>(async () => undefined);
vi.mock('./frames', async (original) => ({
  ...(await original<typeof import('./frames')>()),
  scanFrames,
  fillFrames,
  asForm,
}));
const answerFields = vi.fn<typeof import('./ai').answerFields>();
const draftAnswer = vi.fn<typeof import('./ai').draftAnswer>();
vi.mock('./ai', async (original) => ({
  ...(await original<typeof import('./ai')>()),
  answerFields,
  draftAnswer,
}));

const {
  asApplication,
  cardState,
  fill,
  logApplication,
  pageHolds,
  readTab,
  saveJob,
  select,
  snapshot,
  undo,
} = await import('./card');
const { getSession, updateSession } = await import('./session');
const { DEFAULT_SETTINGS, loggedItem, openaiKeyItem, profileItem, settingsItem, snapshotsItem } =
  await import('../storage');

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
    expect(state.accounts[0]?.appliedAt).toBeNull();

    // Applied to: by which account, and on what day.
    loadSnapshot.mockResolvedValue(tracked(true));
    const applied = await saveJob(TAB, URL_);
    expect(applied.tracked).toBe('applied');
    expect(applied.accounts).toEqual([expect.objectContaining({ id: 'a1', appliedAt: '2026-09-28' })]);
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

describe('telling a job’s page from any other', () => {
  // What the content script reads of a page with no application on it.
  const read = (more: Partial<FrameScan>): FrameScan => ({
    frameId: 0,
    ats: 'generic',
    isApplication: false,
    applying: false,
    sends: false,
    jobLike: false,
    otherForm: false,
    posting: null,
    fields: [],
    step: null,
    ...more,
  });
  const MAIL = 'https://mail.google.com/mail/u/0/';
  const inbox: Posting = { ...posting, ats: 'generic', company: 'Google', title: 'Inbox (3)', url: MAIL };
  // A tab of its own for each test: a tab's session outlives the storage a test starts from.
  let tab = 300;

  beforeEach(async () => {
    fakeBrowser.reset();
    vi.clearAllMocks();
    tab++;
    loadSnapshot.mockResolvedValue(empty);
    syncProfile.mockResolvedValue(null);
  });

  it('takes a page on any other site for a job only where the page gives itself out as one', async () => {
    // The owner's mail names a "company" and a "title" as any page does, and is no job.
    scanFrames.mockResolvedValue([read({ posting: inbox })]);
    expect(await readTab(tab, MAIL)).toMatchObject({ jobPage: false, hasForm: false });
    // The same reading at a job's address, or of a page marked up as a posting.
    scanFrames.mockResolvedValue([read({ posting: inbox, jobLike: true })]);
    expect(await readTab(tab, MAIL)).toMatchObject({ jobPage: true });
  });

  it('goes by the page itself, not by a frame inside it', async () => {
    scanFrames.mockResolvedValue([
      read({ posting: inbox }),
      // An ad from a job board, in a frame of its own.
      read({ frameId: 4, jobLike: true, posting: null }),
    ]);
    expect(await readTab(tab, MAIL)).toMatchObject({ jobPage: false });
  });

  it('takes a hiring system’s page for a posting where it names a company and a title, as the card opens there', async () => {
    scanFrames.mockResolvedValue([read({ ats: 'greenhouse', jobLike: true, posting })]);
    expect(await readTab(tab, URL_)).toMatchObject({ jobPage: true });
    // The board's list of openings names the company and no title.
    const board = 'https://job-boards.greenhouse.io/arcadia';
    scanFrames.mockResolvedValue([
      read({ ats: 'greenhouse', jobLike: true, posting: { ...posting, title: null, url: board } }),
    ]);
    expect(await readTab(tab + 1000, board)).toMatchObject({ jobPage: false });
  });

  it('takes a page Outbox tracks for the job it is, whatever its address says', async () => {
    loadSnapshot.mockResolvedValue(tracked(false));
    scanFrames.mockResolvedValue([read({ posting: { ...posting, ats: 'generic' } })]);
    expect(await readTab(tab, URL_)).toMatchObject({ jobPage: true, tracked: 'saved' });
  });

  it('takes a page for a job once the owner has logged it from the card’s menu, and through its Undo', async () => {
    scanFrames.mockResolvedValue([read({ posting: inbox })]);
    await readTab(tab, MAIL);
    quickAddOrQueue.mockResolvedValue({ ...saved, applicationIds: ['p1'] });
    expect(await logApplication(tab, MAIL, true)).toMatchObject({ jobPage: true });
    expect(await undo(tab, MAIL)).toMatchObject({ jobPage: true, logged: { undone: true } });
  });

  it('says there is a form the owner can call an application, where none was found', async () => {
    scanFrames.mockResolvedValue([read({ posting: inbox, otherForm: true })]);
    expect(await readTab(tab, MAIL)).toMatchObject({ jobPage: false, otherForm: true });
    // An application found in one frame is the page's form: no other is offered beside it.
    scanFrames.mockResolvedValue([
      read({ posting: inbox, otherForm: true }),
      read({ frameId: 2, isApplication: true, posting: inbox }),
    ]);
    expect(await readTab(tab, MAIL)).toMatchObject({ jobPage: true, hasForm: true, otherForm: false });
  });

  it('has every frame read its form as an application at the owner’s word, then reads the page again', async () => {
    scanFrames.mockResolvedValue([read({ posting: inbox, otherForm: true })]);
    await readTab(tab, MAIL);
    asForm.mockImplementation(async () => {
      // Told so, the frame finds the form it had passed over.
      scanFrames.mockResolvedValue([read({ posting: inbox, isApplication: true })]);
    });
    expect(await asApplication(tab, MAIL)).toMatchObject({ hasForm: true, jobPage: true, otherForm: false });
    expect(asForm).toHaveBeenCalledWith(tab);
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

  describe('as the owner goes on by hand', () => {
    // When the fill left its fields, by the page's clock; a look at the page is before or after that.
    const FILLED_AT = 1000;
    const left = (value: string) => ({ ok: true, value, at: FILLED_AT });
    /** A filled form: two questions the rules had nothing for, and four answers put in. */
    const filled = (tab: number) =>
      updateSession(tab, URL_, () => ({
        hasForm: true,
        fields: [
          scanned('0:office', 'Preferred office', true),
          scanned('0:used', 'Have you used Arcadia?', false),
          scanned('0:first', 'First Name', true),
          scanned('0:site', 'Website', false),
          scanned('0:auth', 'Are you authorized to work in the US?', true),
          scanned('0:news', 'Send me product news', false),
        ],
        plan: [
          planned('0:office', 'missing'),
          planned('0:used', 'skipped'),
          planned('0:first', 'filled', 'Alex'),
          planned('0:site', 'filled', 'https://alex.example'),
          planned('0:auth', 'confirm', 'Yes'),
          planned('0:news', 'filled', 'No'),
        ],
        results: {
          '0:first': left('Alex'),
          '0:site': left('https://alex.example'),
          '0:auth': left('Yes'),
          // A box the fill left unticked.
          '0:news': left('unchecked'),
        },
      }));
    /** What the page was seen to hold, each field's line in the list by its label. */
    const seen = async (
      tab: number,
      at: number,
      fields: Record<string, { filled: boolean; value?: string }>,
    ) => {
      await pageHolds(tab, URL_, 0, { at, fields });
      const { checklist } = await cardState((await getSession(tab))!);
      return Object.fromEntries(checklist.map(({ label, status, value }) => [label, [status, value]]));
    };
    const card = vi.spyOn(fakeBrowser.tabs, 'sendMessage') as unknown as MockInstance<
      (tab: number, message: object, to: object) => Promise<unknown>
    >;
    let tab = 200;

    beforeEach(() => {
      tab++;
      card.mockResolvedValue(undefined);
    });

    it('marks done what the owner filled in, and to fill what was emptied', async () => {
      await filled(tab);
      expect(
        await seen(tab, FILLED_AT + 1, {
          '0:office': { filled: true, value: 'Menlo Park, CA' },
          '0:used': { filled: true, value: 'Yes' },
          '0:first': { filled: false },
          '0:site': { filled: false },
          // Changed to another answer: still one to check, and the list shows which.
          '0:auth': { filled: true, value: 'No' },
          '0:news': { filled: false, value: 'unchecked' },
        }),
      ).toEqual({
        'Preferred office': ['filled', 'Menlo Park, CA'],
        'Have you used Arcadia?': ['filled', 'Yes'],
        'First Name': ['missing', null],
        Website: ['skipped', null],
        'Are you authorized to work in the US?': ['confirm', 'No'],
        'Send me product news': ['filled', 'unchecked'],
      });
      // Emptied again, a question the rules had nothing for is as it was.
      expect(await seen(tab, FILLED_AT + 2, { '0:office': { filled: false } })).toMatchObject({
        'Preferred office': ['missing', null],
        'First Name': ['filled', 'Alex'],
      });
    });

    it('takes the fill’s word over a look at the page from before it', async () => {
      await filled(tab);
      expect(
        await seen(tab, FILLED_AT - 1, {
          '0:office': { filled: true, value: 'Menlo Park, CA' },
          '0:first': { filled: false },
        }),
      ).toMatchObject({
        // The fill said nothing of the office, so what was seen there stands.
        'Preferred office': ['filled', 'Menlo Park, CA'],
        'First Name': ['filled', 'Alex'],
      });
    });

    it('sends the card its list alone, without asking Outbox, and not before there is one', async () => {
      await pageHolds(tab, URL_, 0, { at: 1, fields: { '0:office': { filled: true } } });
      expect(card).not.toHaveBeenCalled();

      await filled(tab);
      await pageHolds(tab, URL_, 0, {
        at: FILLED_AT + 2,
        fields: { '0:office': { filled: true, value: 'Menlo Park, CA' } },
      });
      // A look overtaken on its way doesn't take the later one's place.
      await pageHolds(tab, URL_, 0, { at: FILLED_AT + 1, fields: { '0:office': { filled: false } } });
      for (const [to, message, where] of card.mock.calls) {
        expect([to, where]).toEqual([tab, { frameId: 0 }]);
        expect(message).toMatchObject({
          type: 'card:checklist',
          checklist: expect.arrayContaining([
            expect.objectContaining({ fieldId: '0:office', status: 'filled', value: 'Menlo Park, CA' }),
          ]),
        });
      }
      expect(card).toHaveBeenCalledTimes(2);
      expect(loadSnapshot).not.toHaveBeenCalled();
    });

    it('draws the list from the tab as it is by then, though handed an older state of it', async () => {
      const before = await filled(tab);
      await pageHolds(tab, URL_, 0, { at: FILLED_AT + 1, fields: { '0:office': { filled: true } } });
      const { checklist } = await cardState(before);
      expect(checklist.find((item) => item.fieldId === '0:office')?.status).toBe('filled');
    });
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
    {
      frameId: 0,
      ats: 'greenhouse',
      isApplication: true,
      applying: false,
      sends: true,
      jobLike: true,
      otherForm: false,
      posting,
      fields,
      step: null,
    },
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

  it('keeps the resume when an account is chosen on the card, and the account when a resume is', async () => {
    const file = { name: 'Resume.pdf', size: 9, uploadedAt: T0 };
    loadSnapshot.mockResolvedValue({
      ...empty,
      accounts: [
        { id: 'a1', label: '', email: 'one@example.com', color: 'blue', createdAt: T0 },
        { id: 'a2', label: '', email: 'two@example.com', color: 'green', createdAt: T0 },
      ],
      resumes: [
        { id: 'r1', name: 'SDE', createdAt: T0, file },
        { id: 'r2', name: 'Agent', createdAt: T0, file },
      ],
    });
    scanFrames.mockResolvedValue(
      form([field('0:email', 'Email', { kind: 'email' }), field('0:resume', 'Resume', { kind: 'file' })]),
    );
    await updateSession(tab, URL_, () => ({ accountId: 'a1', resumeId: 'r1' }));

    // As the card's message arrives: the one that was chosen, and nothing for the other.
    const chosen = await select(tab, URL_, { accountId: 'a2', resumeId: undefined });
    expect(chosen).toMatchObject({ accountId: 'a2', resumeId: 'r1' });
    await fill(tab, URL_);
    expect(fillFrames).toHaveBeenCalledWith(tab, [
      expect.objectContaining({ fieldId: '0:email', answer: { type: 'text', text: 'two@example.com' } }),
      expect.objectContaining({ fieldId: '0:resume', answer: { type: 'file', resumeId: 'r1' } }),
    ]);

    expect(await select(tab, URL_, { accountId: undefined, resumeId: 'r2' })).toMatchObject({
      accountId: 'a2',
      resumeId: 'r2',
    });
  });

  describe('with AI for what the rules leave', () => {
    const essays = [
      field('0:why', 'Why do you want to work at Arcadia Cloud?', { kind: 'textarea' }),
      field('0:project', 'Tell us about a project you are proud of', { kind: 'textarea' }),
      field('0:hard', 'Describe the hardest bug you have fixed', { kind: 'textarea' }),
    ];
    const draftOf = (id: string) => `A draft for ${id}`;
    const allDrafts = Object.fromEntries(essays.map(({ id }) => [id, draftOf(id)]));
    /** What the AI put into the plan, by field. */
    const drafted = async () =>
      Object.fromEntries(
        ((await getSession(tab))?.plan ?? [])
          .filter((entry) => entry.source === 'ai')
          .map((entry) => [entry.fieldId, entry.answer?.type === 'text' ? entry.answer.text : null]),
      );
    const settled = (ai: 'ready' | 'failed') =>
      vi.waitFor(async () => expect((await getSession(tab))?.ai).toBe(ai), { timeout: 3000 });

    beforeEach(async () => {
      await settingsItem.setValue({ ...DEFAULT_SETTINGS, aiEnabled: true });
      await openaiKeyItem.setValue('sk-test');
      scanFrames.mockResolvedValue(
        form([
          field('0:first', 'First Name'),
          field('0:color', 'Favorite color', { maxLength: 40 }),
          ...essays,
        ]),
      );
      answerFields.mockResolvedValue([]);
    });

    it('asks for the drafts together, and writes them into the page one at a time', async () => {
      const leftovers = later<never[]>();
      answerFields.mockReturnValue(leftovers.promise);
      const drafts = new Map<string, ReturnType<typeof later<string>>>();
      draftAnswer.mockImplementation((question) => {
        const draft = later<string>();
        drafts.set(question.id, draft);
        return draft.promise;
      });
      let writing = 0;
      let mostWriting = 0;
      fillFrames.mockImplementation(async (_tab, plan) => {
        mostWriting = Math.max(mostWriting, ++writing);
        await new Promise((done) => setTimeout(done, 5));
        writing--;
        return Object.fromEntries(
          plan.filter((entry) => entry.answer).map((entry) => [entry.fieldId, { ok: true }]),
        );
      });

      await fill(tab, URL_);
      // Three requests are out before any has come back: the leftover field's, and two of the drafts'.
      await vi.waitFor(() => {
        expect(answerFields).toHaveBeenCalledTimes(1);
        expect(draftAnswer).toHaveBeenCalledTimes(2);
      });
      // One comes back, and the third draft goes out.
      leftovers.settle([]);
      await vi.waitFor(() => expect(draftAnswer).toHaveBeenCalledTimes(3));
      // The drafts come back at once, the last one first.
      for (const { id } of [...essays].reverse()) drafts.get(id)?.settle(draftOf(id));
      await settled('ready');

      expect(await drafted()).toEqual(allDrafts);
      expect(mostWriting).toBe(1);
    });

    it('asks again only for what stands empty, when the form is filled again', async () => {
      draftAnswer.mockImplementation(async (question) => draftOf(question.id));
      await fill(tab, URL_);
      await settled('ready');
      expect(draftAnswer).toHaveBeenCalledTimes(3);

      // Filled again. The page reads two drafts as standing as AI left them, and the third as emptied since.
      const [why, project, hard] = essays;
      scanFrames.mockResolvedValue(
        form([
          field('0:first', 'First Name'),
          field('0:color', 'Favorite color', { maxLength: 40 }),
          { ...why!, filled: true, drafted: true },
          { ...project!, filled: true, drafted: true },
          hard!,
        ]),
      );
      draftAnswer.mockImplementation(async (question) => `Another draft for ${question.id}`);
      await fill(tab, URL_);
      await settled('ready');

      expect(draftAnswer).toHaveBeenCalledTimes(4);
      expect(draftAnswer.mock.calls.at(-1)?.[0]).toMatchObject({ id: '0:hard' });
      // The standing drafts keep their lines of the plan, as AI's and with what AI wrote.
      expect(await drafted()).toEqual({
        '0:why': draftOf('0:why'),
        '0:project': draftOf('0:project'),
        '0:hard': 'Another draft for 0:hard',
      });
      expect((await getSession(tab))?.plan.find((entry) => entry.fieldId === '0:why')?.status).toBe('draft');
    });

    it('gives a request that failed among the others a second go, alone', async () => {
      let out = 0;
      let refused = false;
      const outAtSecondGo: number[] = [];
      draftAnswer.mockImplementation(async (question) => {
        const again = question.id === '0:project' && refused;
        if (again) outAtSecondGo.push(out);
        out++;
        try {
          await new Promise((done) => setTimeout(done, 5));
          if (question.id === '0:project' && !again) {
            refused = true;
            throw new Error('429 Too many requests');
          }
          return draftOf(question.id);
        } finally {
          out--;
        }
      });

      await fill(tab, URL_);
      await settled('ready');

      expect(draftAnswer).toHaveBeenCalledTimes(4);
      expect(outAtSecondGo).toEqual([0]);
      expect(await drafted()).toEqual(allDrafts);
      expect((await getSession(tab))?.error).toBeNull();
    });

    it('says so when a request fails twice, and keeps what the others drafted', async () => {
      draftAnswer.mockImplementation(async (question) => {
        if (question.id === '0:project') throw new Error('500 upstream error');
        return draftOf(question.id);
      });

      await fill(tab, URL_);
      await settled('failed');

      expect((await getSession(tab))?.error).toBe('ai: 500 upstream error');
      expect(await drafted()).toEqual({ '0:why': draftOf('0:why'), '0:hard': draftOf('0:hard') });
      expect(draftAnswer).toHaveBeenCalledTimes(4);
    });
  });
});
