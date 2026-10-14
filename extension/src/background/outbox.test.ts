import type { QuickAddInput } from '@domain/repository';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { pendingLogsItem, type PendingLog } from '../storage';
import { flushQueue, OutboxRejected, quickAddOrQueue } from './outbox';

const input = (companyName: string, more: Partial<QuickAddInput> = {}): QuickAddInput => ({
  companyName,
  title: 'Engineer',
  url: null,
  jobId: null,
  accountIds: ['a1'],
  channelId: 'ch_company_site',
  resumeId: 'r1',
  appliedAt: '2026-10-14',
  ...more,
});
const queued = (id: string, more: Partial<QuickAddInput> = {}): PendingLog => ({
  id,
  at: '2026-10-14T00:00:00.000Z',
  input: input(id, more),
});
const result = { jobId: 'j', createdJobId: 'j', createdCompanyId: null, applicationIds: [] };

/** Outbox's quick-add as the extension sees it: what each request carried, and the answer `reply` gives it. */
let sent: QuickAddInput[] = [];
let reply: (body: QuickAddInput) => Response = () => Response.json(result, { status: 201 });

beforeEach(() => {
  fakeBrowser.reset();
  sent = [];
  reply = () => Response.json(result, { status: 201 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as QuickAddInput;
      sent.push(body);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return reply(body);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the queue of logs that waited for Outbox', () => {
  it('sends each log once when it’s flushed from two places at once', async () => {
    await pendingLogsItem.setValue([queued('A'), queued('B')]);
    await Promise.all([flushQueue(), flushQueue()]);
    expect(sent.map((body) => body.companyName)).toEqual(['A', 'B']);
    expect(await pendingLogsItem.getValue()).toEqual([]);
  });

  it('keeps a log queued while a flush runs, and sends it after', async () => {
    await pendingLogsItem.setValue([queued('A'), queued('B')]);
    const flushing = flushQueue();
    await new Promise((resolve) => setTimeout(resolve, 2));
    await pendingLogsItem.setValue([...(await pendingLogsItem.getValue()), queued('C')]);
    void flushQueue();
    await flushing;
    await vi.waitFor(async () => expect(await pendingLogsItem.getValue()).toEqual([]));
    expect(sent.map((body) => body.companyName)).toEqual(['A', 'B', 'C']);
  });

  it('sends a log Outbox turns down without the resume, then without the account, then drops it', async () => {
    // The resume version, then the account, were deleted on Outbox after A was queued; B was never valid.
    const takes = (body: QuickAddInput) =>
      body.companyName === 'C' ||
      (body.companyName === 'A' && body.resumeId === null && body.accountIds.length === 0);
    reply = (body) =>
      takes(body) ? Response.json(result, { status: 201 }) : new Response('Not found', { status: 404 });
    await pendingLogsItem.setValue([
      queued('A'),
      queued('B', { resumeId: null, accountIds: [] }),
      queued('C'),
    ]);
    expect(await flushQueue()).toBe(3);
    expect(sent.map((body) => [body.companyName, body.resumeId, body.accountIds.length])).toEqual([
      ['A', 'r1', 1],
      ['A', null, 1],
      ['A', null, 0],
      ['B', null, 0],
      ['C', 'r1', 1],
    ]);
    expect(await pendingLogsItem.getValue()).toEqual([]);
  });

  it('stops at a log that can’t reach Outbox, and keeps it and the rest', async () => {
    reply = (body) =>
      body.companyName === 'B'
        ? new Response('down', { status: 503 })
        : Response.json(result, { status: 201 });
    await pendingLogsItem.setValue([queued('A'), queued('B'), queued('C')]);
    expect(await flushQueue()).toBe(1);
    expect((await pendingLogsItem.getValue()).map((entry) => entry.id)).toEqual(['B', 'C']);
  });
});

describe('a log as it is made', () => {
  it('is queued when Outbox can’t be reached', async () => {
    reply = () => new Response('down', { status: 502 });
    expect(await quickAddOrQueue(input('A'))).toBeNull();
    expect(await pendingLogsItem.getValue()).toHaveLength(1);
  });

  it('isn’t queued when Outbox turns it down', async () => {
    reply = () => new Response('Not found', { status: 404 });
    await expect(quickAddOrQueue(input('A'))).rejects.toBeInstanceOf(OutboxRejected);
    expect(await pendingLogsItem.getValue()).toEqual([]);
  });
});
