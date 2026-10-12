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
import { giveTicket, takeTicket } from './tickets';

/**
 * The settings are the extension's own page, shown in a frame inside the card's window so that the page under it can
 * neither read what's typed there (an API key) nor press anything in it. Framed, it draws nothing until it shows
 * the ticket the card asked for (tickets.ts).
 */
export function openSettings(tabId: number): { ticket: string } {
  return giveTicket(tabId, { page: 'settings' });
}

/** Whether the framed page may draw: its ticket was given out for the settings, in the tab it's in. */
export function enterSettings(tabId: number | undefined, ticket: string): boolean {
  return takeTicket(tabId, ticket)?.page === 'settings';
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
