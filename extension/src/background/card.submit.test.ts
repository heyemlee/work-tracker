import type { QuickAddResult } from '@domain/repository';
import type { Snapshot } from '@domain/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { PlannedField, Posting } from '../model';

const loadSnapshot = vi.fn<() => Promise<Snapshot>>();
const quickAddOrQueue = vi.fn();
vi.mock('./outbox', () => ({
  loadSnapshot,
  quickAddOrQueue,
  undoQuickAdd: vi.fn(),
  syncProfile: vi.fn(async () => null),
  OutboxSignedOut: class extends Error {},
}));

const { logApplication, submitAttempt, submitConfirmed } = await import('./card');
const { dropSession, getSession, updateSession } = await import('./session');

const URL_ = 'https://job-boards.greenhouse.io/arcadia/jobs/42';
const CONFIRMATION = `${URL_}/confirmation`;
const TAB = 7;
const posting: Posting = {
  ats: 'greenhouse',
  company: 'Arcadia Cloud',
  title: 'Agent Infrastructure Engineer',
  url: URL_,
  location: 'San Francisco, CA',
  description: '',
};
const added: QuickAddResult = {
  jobId: 'j1',
  createdJobId: 'j1',
  createdCompanyId: 'c1',
  applicationIds: ['p1'],
};

const T0 = '2026-09-28T12:00:00.000Z';
/** Two accounts to apply from, and one resume version. */
const outbox: Snapshot = {
  accounts: [
    { id: 'a1', label: '', email: 'one@example.com', color: 'blue', createdAt: T0 },
    { id: 'a2', label: '', email: 'two@example.com', color: 'green', createdAt: T0 },
  ],
  resumes: [{ id: 'r1', name: 'SDE', createdAt: T0, file: { name: 'Resume.pdf', size: 9, uploadedAt: T0 } }],
  channels: [],
  companies: [],
  jobs: [],
  applications: [],
};

/** A line of a fill's plan: the extension filled this tab's form. */
const filled: PlannedField = {
  fieldId: '0:first',
  status: 'filled',
  answer: { type: 'text', text: 'Alex' },
  source: 'rule',
  key: 'name.first',
  note: null,
  critical: false,
};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

beforeEach(async () => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  loadSnapshot.mockResolvedValue(outbox);
  quickAddOrQueue.mockResolvedValue(added);
  await dropSession(TAB);
  // The card read the posting and chose the first account; nothing was filled.
  await updateSession(TAB, URL_, () => ({ ats: 'greenhouse', posting, accountId: 'a1', resumeId: 'r1' }));
});

describe('a submission the page confirms', () => {
  it('is logged though the extension never filled the form, once the owner was seen to send it', async () => {
    await submitAttempt(TAB, URL_, [], []);
    await submitConfirmed(TAB, CONFIRMATION);

    expect(quickAddOrQueue).toHaveBeenCalledTimes(1);
    expect(quickAddOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Arcadia Cloud',
        title: 'Agent Infrastructure Engineer',
        url: URL_,
        accountIds: ['a1'],
        channelId: 'ch_company_site',
        resumeId: 'r1',
      }),
    );
    expect((await getSession(TAB))?.logged).toEqual({ result: added, undone: false, manual: false });
  });

  it('is logged wherever the page confirms it: its address needn’t be the posting’s', async () => {
    await submitAttempt(TAB, URL_, [], []);
    await submitConfirmed(TAB, 'https://careers.arcadia.example/thanks');
    expect(quickAddOrQueue).toHaveBeenCalledTimes(1);
  });

  it('isn’t logged where no form was seen to be sent: such a page can be opened without applying', async () => {
    await submitConfirmed(TAB, CONFIRMATION);
    expect(quickAddOrQueue).not.toHaveBeenCalled();
    expect((await getSession(TAB))?.logged).toBeNull();
  });

  it('isn’t logged when the form was sent too long ago to be this page’s', async () => {
    await updateSession(TAB, URL_, () => ({ submittedAt: minutesAgo(16) }));
    await submitConfirmed(TAB, CONFIRMATION);
    expect(quickAddOrQueue).not.toHaveBeenCalled();

    await updateSession(TAB, URL_, () => ({ submittedAt: minutesAgo(14) }));
    await submitConfirmed(TAB, CONFIRMATION);
    expect(quickAddOrQueue).toHaveBeenCalledTimes(1);
  });

  it('is logged for a form the extension filled though its sending went unseen, at the posting’s own address', async () => {
    await updateSession(TAB, URL_, () => ({ plan: [filled] }));
    await submitConfirmed(TAB, 'https://job-boards.greenhouse.io/arcadia/jobs/77/confirmation');
    expect(quickAddOrQueue).not.toHaveBeenCalled();

    await submitConfirmed(TAB, CONFIRMATION);
    expect(quickAddOrQueue).toHaveBeenCalledTimes(1);
  });

  it('is logged once', async () => {
    await submitAttempt(TAB, URL_, [], []);
    await submitConfirmed(TAB, CONFIRMATION);
    await submitConfirmed(TAB, CONFIRMATION);
    expect(quickAddOrQueue).toHaveBeenCalledTimes(1);
  });
});

describe('the account a submission is logged under', () => {
  it('is the one whose email the form held as it was sent, whichever the card had chosen', async () => {
    await submitAttempt(TAB, URL_, [], ['Two@Example.com']);
    await submitConfirmed(TAB, CONFIRMATION);

    expect(quickAddOrQueue).toHaveBeenCalledWith(expect.objectContaining({ accountIds: ['a2'] }));
    // And the card goes on with that account: Undo and logging again are its.
    expect((await getSession(TAB))?.accountId).toBe('a2');
  });

  it.each([
    ['holds no email', []],
    ['holds an email that is no account’s', ['someone@else.example']],
    ['holds the card’s account’s among others', ['two@example.com', 'one@example.com']],
  ])('is the card’s choice where the form %s', async (_, emails) => {
    await submitAttempt(TAB, URL_, [], emails);
    await submitConfirmed(TAB, CONFIRMATION);
    expect(quickAddOrQueue).toHaveBeenCalledWith(expect.objectContaining({ accountIds: ['a1'] }));
  });

  it('is the card’s choice where the form names two other accounts: it doesn’t tell which', async () => {
    loadSnapshot.mockResolvedValue({
      ...outbox,
      accounts: [
        ...outbox.accounts,
        { id: 'a3', label: '', email: 'three@example.com', color: 'pink', createdAt: T0 },
      ],
    });
    await submitAttempt(TAB, URL_, [], ['two@example.com', 'three@example.com']);
    await submitConfirmed(TAB, CONFIRMATION);
    expect(quickAddOrQueue).toHaveBeenCalledWith(expect.objectContaining({ accountIds: ['a1'] }));
  });

  it('is the card’s choice for a log made by hand from the card', async () => {
    await submitAttempt(TAB, URL_, [], ['two@example.com']);
    await logApplication(TAB, URL_, true);
    expect(quickAddOrQueue).toHaveBeenCalledWith(expect.objectContaining({ accountIds: ['a1'] }));
    expect((await getSession(TAB))?.accountId).toBe('a1');
  });

  it('isn’t logged twice for the account the form named, which had applied already', async () => {
    loadSnapshot.mockResolvedValue({
      ...outbox,
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
      applications: [
        {
          id: 'p1',
          jobId: 'j1',
          accountId: 'a2',
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
    });
    await submitAttempt(TAB, URL_, [], ['two@example.com']);
    await submitConfirmed(TAB, CONFIRMATION);
    expect(quickAddOrQueue).not.toHaveBeenCalled();
    expect((await getSession(TAB))?.error).toBe('alreadyLogged');
  });
});
