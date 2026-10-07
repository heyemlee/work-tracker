import type { SettingsStatus } from '../messages';
import { clearResumeCopies } from '../resumes';
import {
  apiKeyItem,
  finalsItem,
  lastUsedItem,
  memoryItem,
  openaiKeyItem,
  pendingLogsItem,
  profileItem,
  profileSourceItem,
  snapshotsItem,
  usageItem,
} from '../storage';
import { flushQueue, loadSnapshot, OutboxSignedOut, syncProfile } from './outbox';

/**
 * The settings are the extension's own page, shown in a frame inside the card's window so that the page under it can
 * neither read what's typed there (an API key) nor press anything in it. The page is reachable by address from any
 * site, so framed it draws nothing until it shows a ticket: one the card asked for, for its own tab, good for one
 * showing.
 */
const tickets = new Map<string, number>();

export function openSettings(tabId: number): { ticket: string } {
  const ticket = crypto.randomUUID();
  tickets.set(ticket, tabId);
  return { ticket };
}

/** Whether the framed page may draw: the ticket was given out for the tab it's in. A ticket works once. */
export function enterSettings(tabId: number | undefined, ticket: string): boolean {
  const allowed = tabId !== undefined && tickets.get(ticket) === tabId;
  tickets.delete(ticket);
  return allowed;
}

/** A closed tab's tickets are no use to anyone. */
export function dropTickets(tabId: number): void {
  for (const [ticket, owner] of tickets) if (owner === tabId) tickets.delete(ticket);
}

/**
 * Outbox, as the settings show it: asked afresh. While it answers, logs that waited go out and the profile's copy
 * here is brought up to date.
 */
export async function settingsStatus(): Promise<SettingsStatus> {
  try {
    const snapshot = await loadSnapshot(true);
    void flushQueue().catch(() => undefined);
    void syncProfile().catch(() => undefined);
    return {
      outbox: { state: 'connected', accounts: snapshot.accounts.length },
      resumes: snapshot.resumes.filter((resume) => resume.file).map((resume) => resume.name),
    };
  } catch (error) {
    return {
      outbox:
        error instanceof OutboxSignedOut
          ? { state: 'signedOut' }
          : { state: 'unreachable', detail: error instanceof Error ? error.message : String(error) },
      resumes: null,
    };
  }
}

/** Takes everything the extension keeps out of this browser; the settings themselves stay. Outbox keeps its own. */
export async function deleteEverything(): Promise<void> {
  await clearResumeCopies();
  await Promise.all([
    profileItem.removeValue(),
    profileSourceItem.removeValue(),
    apiKeyItem.removeValue(),
    openaiKeyItem.removeValue(),
    memoryItem.removeValue(),
    finalsItem.removeValue(),
    snapshotsItem.removeValue(),
    usageItem.removeValue(),
    lastUsedItem.removeValue(),
    pendingLogsItem.removeValue(),
  ]);
}
