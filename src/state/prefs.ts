import { useSyncExternalStore } from 'react';
import type { Id } from '../domain/types';

export type Locale = 'en' | 'zh';
export type ThemePref = 'system' | 'light' | 'dark';
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

export interface Prefs {
  locale: Locale;
  theme: ThemePref;
  hideRejected: boolean;
  tweaks: Tweaks;
  lastUsed: LastUsed;
}

export const DEFAULT_TWEAKS: Tweaks = { accent: 'mono', blur: 20, tint: 1, refraction: true, glow: 1 };

const DEFAULTS: Prefs = {
  locale: 'en',
  theme: 'system',
  hideRejected: false,
  tweaks: DEFAULT_TWEAKS,
  lastUsed: { accountIds: ['acc_a'], channelId: 'ch_company_site', resumeId: 'res_sde' },
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

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Selects a slice of preferences. Selectors must return stored values rather than build new objects. */
export function usePrefs<T>(selector: (prefs: Prefs) => T): T {
  return useSyncExternalStore(subscribe, () => selector(current));
}
