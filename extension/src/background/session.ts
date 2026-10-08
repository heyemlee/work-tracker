import { storage } from 'wxt/utils/storage';
import type { Ats, FrameHeld, PlannedField, Posting, ScannedField } from '../model';
import type { MatchReport } from '../match/report';
import type { CapturedAnswer, CardState, Phase } from '../messages';
import type { QuickAddResult } from '@domain/repository';

/** What the extension knows about one tab. Kept in session storage so a restarted service worker picks it up. */
export interface TabSession {
  tabId: number;
  /** The address bar: the company's career page when the form is embedded. */
  url: string;
  ats: Ats | null;
  posting: Posting | null;
  hasForm: boolean;
  step: string | null;
  fields: ScannedField[];
  plan: PlannedField[];
  results: Record<string, { ok: boolean; value?: string; error?: string; at?: number }>;
  /** What each frame's fields were last seen to hold, by frame id: the owner goes on by hand after a fill. */
  held: Record<number, FrameHeld>;
  accountId: string | null;
  resumeId: string | null;
  /** The Outbox job this posting matched, when it's already tracked. */
  jobId: string | null;
  match: MatchReport | null;
  phase: Phase;
  ai: CardState['ai'];
  error: string | null;
  /** When the owner pressed Submit; a confirmation within 15 minutes logs the application. */
  submittedAt: string | null;
  captured: CapturedAnswer[];
  /** The emails the form held as the owner sent it: the account applying is the one they name. */
  emails: string[];
  logged: { result: QuickAddResult; undone: boolean; manual: boolean } | null;
  saved: { result: QuickAddResult; undone: boolean } | null;
}

const key = (tabId: number) => `session:tab-${tabId}` as const;
const memory = new Map<number, TabSession>();

export function emptySession(tabId: number, url: string): TabSession {
  return {
    tabId,
    url,
    ats: null,
    posting: null,
    hasForm: false,
    step: null,
    fields: [],
    plan: [],
    results: {},
    held: {},
    accountId: null,
    resumeId: null,
    jobId: null,
    match: null,
    phase: 'idle',
    ai: 'off',
    error: null,
    submittedAt: null,
    captured: [],
    emails: [],
    logged: null,
    saved: null,
  };
}

export async function getSession(tabId: number): Promise<TabSession | null> {
  const cached = memory.get(tabId);
  if (cached) return cached;
  const stored = await storage.getItem<TabSession>(key(tabId));
  // A flow that changed the session while this one waited has the newer one: the stored copy read before that
  // doesn't take its place. A service worker just woken has nothing cached, and a form's sending and the page's
  // confirmation can reach it one behind the other.
  const changed = memory.get(tabId);
  if (changed) return changed;
  if (stored) memory.set(tabId, stored);
  return stored;
}

/**
 * Changes a tab's session. Reading, changing and caching happen with no await in between, so flows running at the
 * same time (reading the page while a submission is logged) each build on the other's result.
 */
export async function updateSession(
  tabId: number,
  url: string,
  change: (session: TabSession) => Partial<TabSession>,
): Promise<TabSession> {
  if (!memory.has(tabId)) {
    const stored = await storage.getItem<TabSession>(key(tabId));
    if (stored && !memory.has(tabId)) memory.set(tabId, stored);
  }
  const current = memory.get(tabId) ?? emptySession(tabId, url);
  const next = { ...current, ...change(current) };
  memory.set(tabId, next);
  await storage.setItem(key(tabId), next);
  return next;
}

export async function dropSession(tabId: number): Promise<void> {
  memory.delete(tabId);
  await storage.removeItem(key(tabId));
}
