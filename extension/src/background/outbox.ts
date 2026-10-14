import type { QuickAddInput, QuickAddResult } from '@domain/repository';
import type { Profile, SavedProfile } from '@domain/profile';
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
 * Outbox was reached and turned the request down (a 4xx other than 401): sent again as it is, it fails again, so
 * it's no reason to wait and retry. Still "unreachable" to callers that only need to know nothing came back.
 */
export class OutboxRejected extends OutboxUnreachable {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(`${status} ${detail}`);
    this.name = 'OutboxRejected';
    this.status = status;
  }
}

/**
 * Calls Outbox's API as the owner. The session cookie goes along first (the extension has host permission for
 * Outbox, so Chrome sends it); if Outbox still answers 401, the session token captured from an open Outbox tab is
 * sent as a bearer token instead.
 */
async function send(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<Response> {
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
  if (response.status >= 400 && response.status < 500)
    throw new OutboxRejected(response.status, await response.text());
  if (!response.ok) throw new OutboxUnreachable(`${response.status} ${await response.text()}`);
  return response;
}

async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
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

/**
 * Logs, or queues the log when Outbox can't be reached, to send with the next successful call. A log Outbox turns
 * down isn't queued: it would be turned down again.
 */
export async function quickAddOrQueue(input: QuickAddInput): Promise<QuickAddResult | null> {
  try {
    const result = await quickAdd(input);
    void flushQueue();
    return result;
  } catch (error) {
    if (error instanceof OutboxSignedOut || error instanceof OutboxRejected) throw error;
    const queue = await pendingLogsItem.getValue();
    await pendingLogsItem.setValue([
      ...queue,
      { id: crypto.randomUUID(), at: new Date().toISOString(), input },
    ]);
    return null;
  }
}

/**
 * A queued log Outbox turns down most likely names what was deleted there since it was queued: a resume version, an
 * account. It goes again without the resume, then without the accounts (the job is still saved); turned down even
 * so, it's dropped, and no longer holds up the logs queued after it.
 */
async function sendQueued(input: QuickAddInput): Promise<void> {
  const tries = [
    input,
    ...(input.resumeId ? [{ ...input, resumeId: null }] : []),
    ...(input.accountIds.length ? [{ ...input, resumeId: null, accountIds: [] }] : []),
  ];
  for (const attempt of tries) {
    try {
      await quickAdd(attempt);
      return;
    } catch (error) {
      if (!(error instanceof OutboxRejected)) throw error;
    }
  }
}

let flushing: Promise<number> | null = null;
let flushAgain = false;

/**
 * Sends queued logs, oldest first, stopping at the first that can't reach Outbox. One flush runs at a time: asked
 * for while one runs, it runs once more after it, for what was queued meanwhile. Two at once would send each log
 * twice, and Outbox would take the second for another job.
 */
export function flushQueue(): Promise<number> {
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  flushing = (async () => {
    let total = 0;
    do {
      flushAgain = false;
      const queue = await pendingLogsItem.getValue();
      const done = new Set<string>();
      for (const entry of queue) {
        try {
          await sendQueued(entry.input);
          done.add(entry.id);
        } catch {
          break;
        }
      }
      if (done.size > 0)
        await pendingLogsItem.setValue(
          (await pendingLogsItem.getValue()).filter((entry) => !done.has(entry.id)),
        );
      total += done.size;
      if (done.size < queue.length) break;
    } while (flushAgain);
    return total;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
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

/** Saves the profile on Outbox, where it lives, and keeps this browser's copy in step with it. */
export async function saveProfile(profile: Profile): Promise<SavedProfile> {
  const saved = await call<SavedProfile>('PUT', '/profile', profile);
  await profileItem.setValue(saved.profile);
  await profileSourceItem.setValue({ updatedAt: saved.updatedAt, syncedAt: new Date().toISOString() });
  return saved;
}
