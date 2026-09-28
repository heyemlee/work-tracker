import type { QuickAddInput, QuickAddResult } from '@domain/repository';
import type { SavedProfile } from '@domain/profile';
import type { Snapshot } from '@domain/types';
import { getSettings, outboxTokenItem, pendingLogsItem, profileItem, profileSourceItem } from '../storage';

export class OutboxSignedOut extends Error {
  constructor() {
    super('Not signed in to Outbox');
    this.name = 'OutboxSignedOut';
  }
}

export class OutboxUnreachable extends Error {
  constructor(cause: unknown) {
    super(`Outbox is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'OutboxUnreachable';
  }
}

/**
 * Calls Outbox's API as the owner. The session cookie goes along first (the extension has host permission for
 * Outbox, so Chrome sends it); if Outbox still answers 401, the session token captured from an open Outbox tab is
 * sent as a bearer token instead.
 */
async function send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
  const { outboxUrl } = await getSettings();
  const url = `${outboxUrl.replace(/\/$/, '')}/api${path}`;
  const init = (auth: 'cookie' | string): RequestInit => ({
    method,
    credentials: auth === 'cookie' ? 'include' : 'omit',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(auth === 'cookie' ? {} : { Authorization: `Bearer ${auth}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let response: Response;
  try {
    response = await fetch(url, init('cookie'));
    if (response.status === 401) {
      const token = await outboxTokenItem.getValue();
      if (token) response = await fetch(url, init(token));
    }
  } catch (error) {
    throw new OutboxUnreachable(error);
  }
  if (response.status === 401) throw new OutboxSignedOut();
  if (!response.ok) throw new OutboxUnreachable(`${response.status} ${await response.text()}`);
  return response;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await send(method, path, body);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

let cached: { at: number; snapshot: Snapshot } | null = null;

/** Accounts, resumes, jobs and applications. Cached for a minute; logging clears the cache. */
export async function loadSnapshot(force = false): Promise<Snapshot> {
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.snapshot;
  const snapshot = await call<Snapshot>('GET', '/snapshot');
  cached = { at: Date.now(), snapshot };
  return snapshot;
}

/** A resume version's PDF, as the owner uploaded it on Outbox. */
export async function downloadResume(id: string): Promise<Blob> {
  const response = await send('GET', `/resumes/${encodeURIComponent(id)}/file`);
  return response.blob();
}

export async function quickAdd(input: QuickAddInput): Promise<QuickAddResult> {
  const result = await call<QuickAddResult>('POST', '/quick-add', input);
  cached = null;
  return result;
}

export async function undoQuickAdd(result: QuickAddResult): Promise<void> {
  await call<void>('POST', '/quick-add/undo', result);
  cached = null;
}

/** Logs, or queues the log when Outbox can't be reached, to send with the next successful call. */
export async function quickAddOrQueue(input: QuickAddInput): Promise<QuickAddResult | null> {
  try {
    const result = await quickAdd(input);
    void flushQueue();
    return result;
  } catch (error) {
    if (error instanceof OutboxSignedOut) throw error;
    const queue = await pendingLogsItem.getValue();
    await pendingLogsItem.setValue([
      ...queue,
      { id: crypto.randomUUID(), at: new Date().toISOString(), input },
    ]);
    return null;
  }
}

/** Sends queued logs, oldest first, stopping at the first failure. */
export async function flushQueue(): Promise<number> {
  const queue = await pendingLogsItem.getValue();
  let sent = 0;
  for (const entry of queue) {
    try {
      await quickAdd(entry.input);
      sent++;
    } catch {
      break;
    }
  }
  if (sent > 0) await pendingLogsItem.setValue((await pendingLogsItem.getValue()).slice(sent));
  return sent;
}

/**
 * Copies the profile the owner edits on Outbox into this browser, where filling reads it. When Outbox can't be
 * reached the last copy stays in use. Returns the profile Outbox holds, or null if none was saved yet.
 */
export async function syncProfile(): Promise<SavedProfile | null> {
  const { saved } = await call<{ saved: SavedProfile | null }>('GET', '/profile');
  if (!saved) return null;
  await profileItem.setValue(saved.profile);
  await profileSourceItem.setValue({ updatedAt: saved.updatedAt, syncedAt: new Date().toISOString() });
  return saved;
}
