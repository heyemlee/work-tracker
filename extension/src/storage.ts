import { storage } from 'wxt/utils/storage';
import type { Answer, Ats, FieldKind, FieldStatus, Hint } from './model';
import type { Profile } from './profile/schema';
import type { MemoryEntry } from './rules/memory';

export type Model = 'claude-opus-5' | 'claude-sonnet-5';
export type Language = 'auto' | 'en' | 'zh';

export interface Settings {
  /** Where Outbox runs; `http://localhost:5180` while developing. */
  outboxUrl: string;
  model: Model;
  /** Warn after this many postings at one company in 30 days. */
  sameCompanyLimit: number;
  language: Language;
  /** Draft free-text answers and settle unknown fields with Claude. Needs an API key. */
  aiEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  outboxUrl: 'https://tracker.haoyang.us',
  model: 'claude-opus-5',
  sameCompanyLimit: 3,
  language: 'auto',
  aiEnabled: true,
};

/** A resume PDF kept on this machine (the file itself is in IndexedDB), tied to an Outbox resume version. */
export interface ResumeMeta {
  id: string;
  fileName: string;
  size: number;
  /** The Outbox resume version it stands for; the name shown on the card comes from there. */
  outboxResumeId: string | null;
  label: string;
  addedAt: string;
}

/** An AI draft the owner edited before submitting: an example of their voice for later drafts. */
export interface FinalAnswer {
  question: string;
  company: string;
  text: string;
  at: string;
}

export interface UsageDay {
  day: string;
  inputTokens: number;
  outputTokens: number;
  /** US dollars, from the model's list price. */
  cost: number;
}

/** A form's structure without any values, saved when a page fills badly. */
export interface FormSnapshot {
  id: string;
  at: string;
  ats: Ats;
  /** Origin and path only: no query string. */
  url: string;
  step: string | null;
  fields: {
    label: string;
    kind: FieldKind;
    options: string[];
    required: boolean;
    hint: Hint | null;
    section: string;
    status: FieldStatus | null;
    key: string | null;
  }[];
  /** The form's markup with values, typed text and hidden inputs stripped. */
  html: string;
}

export interface PendingLog {
  id: string;
  at: string;
  input: import('@domain/repository').QuickAddInput;
}

export const profileItem = storage.defineItem<Profile | null>('local:profile', { fallback: null });
export const profileSourceItem = storage.defineItem<{ fileName: string; importedAt: string } | null>(
  'local:profileSource',
  {
    fallback: null,
  },
);
export const settingsItem = storage.defineItem<Settings>('local:settings', { fallback: DEFAULT_SETTINGS });
export const apiKeyItem = storage.defineItem<string>('local:anthropicKey', { fallback: '' });
export const memoryItem = storage.defineItem<MemoryEntry[]>('local:memory', { fallback: [] });
export const finalsItem = storage.defineItem<FinalAnswer[]>('local:finals', { fallback: [] });
export const usageItem = storage.defineItem<UsageDay[]>('local:usage', { fallback: [] });
export const snapshotsItem = storage.defineItem<FormSnapshot[]>('local:snapshots', { fallback: [] });
export const resumesItem = storage.defineItem<ResumeMeta[]>('local:resumes', { fallback: [] });
export const outboxTokenItem = storage.defineItem<string | null>('local:outboxToken', { fallback: null });
export const pendingLogsItem = storage.defineItem<PendingLog[]>('local:pendingLogs', { fallback: [] });
export const lastUsedItem = storage.defineItem<{ accountId: string | null; resumeId: string | null }>(
  'local:lastUsed',
  {
    fallback: { accountId: null, resumeId: null },
  },
);

/** Settings merged over the defaults, so settings saved by an older version still carry every key. */
export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await settingsItem.getValue()) };
}

export type { Answer };
