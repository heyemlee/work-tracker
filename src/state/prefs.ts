import { useSyncExternalStore } from 'react';
import type { Nudge } from '../domain/setup';
import type { Id, Snapshot } from '../domain/types';

export type Locale = 'en' | 'zh';
export type ThemePref = 'system' | 'light' | 'white' | 'dark';
export const ACCENTS = ['mono', 'blue', 'indigo', 'teal'] as const;
export type Accent = (typeof ACCENTS)[number];

/** Prototype-only visual knobs, exposed by the tweak panel. */
export interface Tweaks {
  accent: Accent;
  /** Backdrop blur radius in px. */
  blur: number;
  /** Multiplier on the glass tint opacity. */
  tint: number;
  refraction: boolean;
  /** Opacity of the ambient background glow. */
  glow: number;
}

/** Composer defaults: whatever was used last. */
export interface LastUsed {
  accountIds: Id[];
  channelId: Id | null;
  resumeId: Id | null;
}

/** What the first-run guide and the home page's checklist remember in this browser. */
export interface SetupPrefs extends Nudge {
  /** The guide was finished or put off, so it no longer opens by itself. */
  guideSeen: boolean;
  /** The extension was ready on Outbox once: the checklist keeps that step done on devices without it. */
  extensionReady: boolean;
  /** The extension reported logging an application once. */
  extensionLogged: boolean;
}

export interface Prefs {
  locale: Locale;
  theme: ThemePref;
  hideRejected: boolean;
  tweaks: Tweaks;
  lastUsed: LastUsed;
  /** Applications a day to aim for; null shows no goal. */
  dailyGoal: number | null;
  setup: SetupPrefs;
}

export const DEFAULT_TWEAKS: Tweaks = { accent: 'mono', blur: 20, tint: 1, refraction: true, glow: 1 };

const DEFAULTS: Prefs = {
  locale: 'en',
  theme: 'white',
  hideRejected: false,
  tweaks: DEFAULT_TWEAKS,
  lastUsed: { accountIds: [], channelId: 'ch_company_site', resumeId: null },
  dailyGoal: 30,
  setup: { hides: 0, hiddenUntil: null, guideSeen: false, extensionReady: false, extensionLogged: false },
};

// Also read by the pre-paint theme script in index.html.
const STORAGE_KEY = 'outbox.prefs.v1';

function load(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...DEFAULTS,
      ...saved,
      tweaks: { ...DEFAULTS.tweaks, ...saved.tweaks },
      lastUsed: { ...DEFAULTS.lastUsed, ...saved.lastUsed },
      setup: { ...DEFAULTS.setup, ...saved.setup },
    };
  } catch {
    return DEFAULTS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return current;
}

export function updatePrefs(update: Partial<Prefs> | ((prefs: Prefs) => Partial<Prefs>)): void {
  current = { ...current, ...(typeof update === 'function' ? update(current) : update) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage unavailable: preferences last for this session only.
  }
  for (const listener of listeners) listener();
}

export function updateTweaks(patch: Partial<Tweaks>): void {
  updatePrefs((prefs) => ({ tweaks: { ...prefs.tweaks, ...patch } }));
}

export function updateSetup(patch: Partial<SetupPrefs>): void {
  updatePrefs((prefs) => ({ setup: { ...prefs.setup, ...patch } }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The remembered composer defaults that still exist in this data. Preferences outlive data — an account
 * deleted, a sample-data id from the prototype — so stale ids are dropped rather than sent to the server.
 */
export function liveDefaults(lastUsed: LastUsed, snapshot: Snapshot): LastUsed {
  return {
    accountIds: snapshot.accounts.filter((a) => lastUsed.accountIds.includes(a.id)).map((a) => a.id),
    channelId: snapshot.channels.some((c) => c.id === lastUsed.channelId) ? lastUsed.channelId : null,
    resumeId: snapshot.resumes.some((r) => r.id === lastUsed.resumeId) ? lastUsed.resumeId : null,
  };
}

/** Selects a slice of preferences. Selectors must return stored values rather than build new objects. */
export function usePrefs<T>(selector: (prefs: Prefs) => T): T {
  return useSyncExternalStore(subscribe, () => selector(current));
}
