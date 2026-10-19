import { useSyncExternalStore } from 'react';
import type { ExtensionSection } from '../domain/bridge';

/**
 * The pages of the settings window: Outbox's own, then the extension's, each one of the extension's settings
 * sections (drawn by the extension itself, in a frame), or, where it isn't running, how to install it.
 */
export type SettingsPage =
  'accounts' | 'channels' | 'general' | `extension.${ExtensionSection}` | 'extension.install';

export const OUTBOX_PAGES = ['accounts', 'channels', 'general'] as const satisfies SettingsPage[];

/** The extension's section a page shows, if it's one of the extension's. */
export function sectionOf(page: SettingsPage): ExtensionSection | null {
  return page.startsWith('extension.') && page !== 'extension.install'
    ? (page.slice('extension.'.length) as ExtensionSection)
    : null;
}

// One window for the whole app: the menu, the quick-add panel and the setup guide open it, each at its own page.
let shown: SettingsPage | null = null;
const listeners = new Set<() => void>();

function set(next: SettingsPage | null) {
  if (next === shown) return;
  shown = next;
  for (const listener of listeners) listener();
}

/** Opens the settings at a page, or turns the open window to it. */
export function openSettings(page: SettingsPage = 'accounts'): void {
  set(page);
}

export function closeSettings(): void {
  set(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The settings page shown, or null while the window is closed. */
export function useSettingsPage(): SettingsPage | null {
  return useSyncExternalStore(subscribe, () => shown);
}
