import { storage } from 'wxt/utils/storage';
import type { Answer, Ats, FieldKind, FieldStatus, Hint } from './model';
import type { Profile } from './profile/schema';
import type { MemoryEntry } from './rules/memory';

/** Anthropic's current models, the most capable first, under the names its API and its site give them. */
export const MODELS = [
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
] as const;
export type Model = (typeof MODELS)[number]['id'];
/** The models the settings offered before these, and the one that took each one's place. */
const SUCCEEDED_BY: Record<string, Model> = {
  'claude-opus-5': 'claude-opus-5-5',
  'claude-sonnet-5': 'claude-sonnet-5-5',
};
/** Who answers the AI requests: Anthropic, or any endpoint speaking OpenAI's chat completions API. */
export type Provider = 'anthropic' | 'openai';
export type Language = 'auto' | 'en' | 'zh';
/** How hard an OpenAI-compatible model thinks before it answers; "auto" leaves it to each kind of request. */
export type Effort = 'auto' | 'low' | 'medium' | 'high';

/** The models the settings offer for an OpenAI-compatible endpoint: the owner's pick of what theirs lists. */
export const OPENAI_MODELS = ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra'];

export interface Settings {
  /** Where Outbox runs; `http://localhost:5180` while developing. */
  outboxUrl: string;
  provider: Provider;
  model: Model;
  /** An OpenAI-compatible endpoint: OpenAI's own, or a proxy. `/v1` is added when it has no path. */
  openaiBaseUrl: string;
  /** Whatever model name the endpoint accepts. */
  openaiModel: string;
  openaiEffort: Effort;
  /** Warn after this many postings at one company in 30 days. */
  sameCompanyLimit: number;
  language: Language;
  /** Draft free-text answers and settle unknown fields with Claude. Needs an API key. */
  aiEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  outboxUrl: 'https://tracker.haoyang.us',
  provider: 'openai',
  model: 'claude-opus-5-5',
  openaiBaseUrl: 'https://api.kabi.pro',
  openaiModel: 'gpt-5.6-terra',
  openaiEffort: 'auto',
  sameCompanyLimit: 3,
  language: 'auto',
  aiEnabled: true,
};

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
  /** Whose posting it was, for the list of reports. Reports saved before these were kept have neither. */
  company?: string | null;
  title?: string | null;
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
/** When the local copy of the profile was saved on Outbox, and when it was last fetched. */
export const profileSourceItem = storage.defineItem<{ updatedAt: string; syncedAt: string } | null>(
  'local:profileSync',
  { fallback: null },
);
export const settingsItem = storage.defineItem<Settings>('local:settings', { fallback: DEFAULT_SETTINGS });
export const apiKeyItem = storage.defineItem<string>('local:anthropicKey', { fallback: '' });
export const openaiKeyItem = storage.defineItem<string>('local:openaiKey', { fallback: '' });
export const memoryItem = storage.defineItem<MemoryEntry[]>('local:memory', { fallback: [] });
export const finalsItem = storage.defineItem<FinalAnswer[]>('local:finals', { fallback: [] });
export const usageItem = storage.defineItem<UsageDay[]>('local:usage', { fallback: [] });
export const snapshotsItem = storage.defineItem<FormSnapshot[]>('local:snapshots', { fallback: [] });
export const outboxTokenItem = storage.defineItem<string | null>('local:outboxToken', { fallback: null });
export const pendingLogsItem = storage.defineItem<PendingLog[]>('local:pendingLogs', { fallback: [] });
/** An application has been logged to Outbox from this browser at least once; Outbox's setup checklist asks. */
export const loggedItem = storage.defineItem<boolean>('local:logged', { fallback: false });
/** The account and the Outbox resume version picked last. */
export const lastUsedItem = storage.defineItem<{ accountId: string | null; resumeId: string | null }>(
  'local:lastUsed',
  {
    fallback: { accountId: null, resumeId: null },
  },
);

/**
 * Settings as they were kept, over the defaults: those saved by an older version still carry every key, and a model
 * that's no longer offered gives way to the one after it.
 */
export function withDefaults(kept: Partial<Settings> | null | undefined): Settings {
  const settings = { ...DEFAULT_SETTINGS, ...kept };
  const model: string = settings.model;
  if (MODELS.some((offered) => offered.id === model)) return settings;
  return { ...settings, model: SUCCEEDED_BY[model] ?? DEFAULT_SETTINGS.model };
}

export async function getSettings(): Promise<Settings> {
  return withDefaults(await settingsItem.getValue());
}

/** The key for the provider in use; empty when there's none. */
export async function aiKey(): Promise<string> {
  const { provider } = await getSettings();
  return provider === 'openai' ? openaiKeyItem.getValue() : apiKeyItem.getValue();
}

export type { Answer };
