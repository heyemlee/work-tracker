import type { ExtensionReadiness, ParseError } from '@domain/bridge';
import type { ResumeFacts } from '@domain/profile';
import type { QuickAddResult } from '@domain/repository';
import type { AccountColor } from '@domain/types';
import { browser, type Browser } from 'wxt/browser';
import type { Answer, Ats, FieldStatus, FrameHeld, FrameScan, PlannedField, Posting, Source } from './model';
import type { MatchReport } from './match/report';
import type { Profile } from './profile/schema';
import type { FormSnapshot } from './storage';

/** What Outbox's page learns when it asks after the extension. */
export interface BridgeStatus {
  readiness: ExtensionReadiness;
  version: string;
  /** An application has been logged from this browser at least once. */
  logged: boolean;
}

/** One line of the card's checklist. */
export interface ChecklistItem {
  fieldId: string;
  label: string;
  status: FieldStatus;
  note: string | null;
  /** What the field holds: as the fill left it, or as the page was seen to hold since. */
  value: string | null;
  /** The form asks for it: it won't go through with the field empty. */
  required: boolean;
  critical: boolean;
  source: Source | null;
  /** The fill reached the page; false when the widget refused the answer. */
  applied: boolean;
}

/** The field holds something: put by a rule, kept from the page, written by AI, or filled in by the owner since. */
export const isDone = (item: Pick<ChecklistItem, 'status' | 'value'>) =>
  item.status === 'filled' || item.status === 'confirm' || (item.status === 'draft' && Boolean(item.value));

export interface CardAccount {
  id: string;
  email: string;
  color: AccountColor;
  /** The day this account applied to this posting, when it has. */
  appliedAt: string | null;
}

export interface CardResume {
  id: string;
  label: string;
}

export type Phase = 'idle' | 'reading' | 'filling' | 'drafting' | 'done';

/** Everything the card shows. The service worker owns it; the card renders whatever it's sent. */
export interface CardState {
  phase: Phase;
  ats: Ats | null;
  posting: Posting | null;
  /** The page holds an application form (not just a posting). */
  hasForm: boolean;
  step: string | null;
  outbox: 'connected' | 'signedOut' | 'unreachable';
  /** Whose answers fill the form, and how many of the blanks most forms ask about the profile still has. */
  profile: { name: string; blanks: number } | null;
  accounts: CardAccount[];
  accountId: string | null;
  resumes: CardResume[];
  resumeId: string | null;
  match: MatchReport | null;
  /** Ashby and Workday merge candidates, so a second account on one posting shows up as a duplicate. */
  duplicateHint: boolean;
  checklist: ChecklistItem[];
  logged: { result: QuickAddResult; undone: boolean; manual: boolean } | null;
  /** Saved for later from this card: a job with no applications yet. */
  saved: { result: QuickAddResult; undone: boolean } | null;
  /** Whether Outbox already tracks this posting, and how far it got. */
  tracked: 'saved' | 'applied' | null;
  ai: 'off' | 'noKey' | 'ready' | 'busy' | 'failed';
  error: string | null;
}

/** The profile as the card's own window opens it for editing. */
export interface ProfileDraft {
  profile: Profile;
  /** Nothing is saved yet: this is a blank to start from. */
  blank: boolean;
  /** Whether Outbox, where the profile lives, could be reached: without it there's no saving. */
  outbox: CardState['outbox'];
}

/** Where a profile doesn't hold: the path into it, and the validator's word for what's wrong there. */
export interface ProfileIssue {
  path: (string | number)[];
  code: string;
}

export type ProfileSaved =
  | { ok: true; profile: Profile; state: CardState | null }
  | { ok: false; error: 'invalid' | 'signedOut' | 'unreachable'; issues: ProfileIssue[] };

/** What the settings show of Outbox: whether it answers, and the resumes it holds a PDF for. */
export interface SettingsStatus {
  outbox:
    | { state: 'connected'; accounts: number }
    | { state: 'signedOut' }
    | { state: 'unreachable'; detail: string };
  /** Null when Outbox didn't answer. */
  resumes: string[] | null;
}

/** An answer the owner typed, read from the page as they submit. */
export interface CapturedAnswer {
  fieldId: string;
  answer: Answer;
}

/**
 * Set on the extension's side of a frame once the content script runs there. The service worker checks it before
 * injecting the script: WXT stops a running copy, card and all, when the same script starts again.
 */
export const RUNNING_FLAG = '__outboxAutofill';

/** Messages to the service worker, and what each one answers. */
export interface ToBackground {
  'frame:hello': { request: { ats: Ats; hasForm: boolean; top: boolean }; response: void };
  /** The frame now shows an application form (see watch.ts): the card should open for it. */
  'frame:form': { request: Record<string, never>; response: void };
  /** What the frame's fields hold now, told each time that has changed: the card's list follows the page. */
  'frame:held': { request: FrameHeld; response: void };
  'card:state': { request: { refresh: boolean }; response: CardState };
  'card:select': { request: { accountId?: string | null; resumeId?: string | null }; response: CardState };
  'card:fill': { request: Record<string, never>; response: CardState };
  'card:focus': { request: { fieldId: string }; response: void };
  'card:snapshot': { request: Record<string, never>; response: { saved: number } };
  'card:log': { request: Record<string, never>; response: CardState };
  /** Saves the posting for later: a job on Outbox with no applications. */
  'card:save': { request: Record<string, never>; response: CardState };
  'card:undo': { request: Record<string, never>; response: CardState };
  /** Opens the settings in a tab of their own: where a page won't take the window or its frame. */
  'card:options': { request: Record<string, never>; response: void };
  /** The card is about to show the settings in its window: a ticket for the framed page to draw with. */
  'settings:open': { request: Record<string, never>; response: { ticket: string } };
  /** From the settings page in the card's window: may it draw? True tells the card it's showing, too. */
  'settings:enter': { request: { ticket: string }; response: boolean };
  /** From the settings page in the card's window: close it. */
  'settings:close': { request: Record<string, never>; response: void };
  'settings:status': { request: Record<string, never>; response: SettingsStatus };
  /** Deletes what the extension keeps in this browser. */
  'settings:deleteAll': { request: Record<string, never>; response: void };
  /** The profile to edit: Outbox's copy, or this browser's when Outbox can't be reached. */
  'profile:load': { request: Record<string, never>; response: ProfileDraft };
  /** Saves the profile on Outbox, where it lives, and in this browser's copy. */
  'profile:save': { request: { profile: unknown }; response: ProfileSaved };
  /** The owner sends the form: its answers as the page holds them, and the emails among its fields. */
  'submit:attempt': { request: { answers: CapturedAnswer[]; emails: string[] }; response: void };
  'submit:confirmed': { request: { url: string }; response: void };
  'outbox:session': { request: { token: string | null }; response: void };
  'resume:read': {
    request: { resumeId: string };
    response: { name: string; type: string; base64: string } | null;
  };
  /** From Outbox's page, through its content script: can a resume be read, and what the setup checklist asks. */
  'bridge:status': { request: Record<string, never>; response: BridgeStatus };
  /** From Outbox's page: read this resume PDF (base64) with the owner's key. */
  'resume:parse': {
    request: { pdf: string; text: string };
    response: { ok: true; facts: ResumeFacts } | { ok: false; error: ParseError; detail: string };
  };
}

/** Messages from the service worker to a frame's content script. */
export interface ToFrame {
  'frame:scan': {
    request: { frameId: number; prepare: { experience: number; education: number } | null };
    response: FrameScan | null;
  };
  'frame:fill': {
    request: { fields: PlannedField[] };
    response: Record<string, { ok: boolean; value?: string; error?: string; at?: number }>;
  };
  'frame:options': { request: { fieldIds: string[] }; response: Record<string, string[]> };
  'frame:read': { request: { fieldIds: string[] }; response: CapturedAnswer[] };
  'frame:focus': { request: { fieldId: string }; response: boolean };
  'frame:snapshot': { request: { plan: PlannedField[] }; response: Omit<FormSnapshot, 'id' | 'at'> | null };
  'card:update': { request: { state: CardState }; response: void };
  /** The list alone, as the page was seen to change under it; the rest of the card stands. */
  'card:checklist': { request: { checklist: ChecklistItem[] }; response: void };
  /**
   * The card answers true, so the service worker knows there is one. `asked` when the owner called for it (the
   * toolbar button), which brings back a card put aside; a form showing on the page opens a closed one only.
   */
  'card:open': { request: { asked: boolean }; response: boolean };
  'card:fill': { request: Record<string, never>; response: boolean };
  /** The settings page drew in the card's window. */
  'settings:shown': { request: Record<string, never>; response: void };
  'settings:close': { request: Record<string, never>; response: void };
}

type Envelope<Map, Type extends keyof Map> = { type: Type } & (Map[Type] extends { request: infer Request }
  ? Request
  : never);
type Reply<Map, Type extends keyof Map> = Map[Type] extends { response: infer Response } ? Response : never;

export type BackgroundMessage = {
  [Type in keyof ToBackground]: Envelope<ToBackground, Type>;
}[keyof ToBackground];
export type FrameMessage = { [Type in keyof ToFrame]: Envelope<ToFrame, Type> }[keyof ToFrame];

export function toBackground<Type extends keyof ToBackground>(
  type: Type,
  request: ToBackground[Type]['request'],
): Promise<Reply<ToBackground, Type>> {
  // A page open while the extension was reloaded or updated keeps its old content script, cut off from the
  // extension: there Chrome throws ("Extension context invalidated") instead of rejecting.
  try {
    return browser.runtime.sendMessage({ type, ...request }) as Promise<Reply<ToBackground, Type>>;
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

export function toFrame<Type extends keyof ToFrame>(
  tabId: number,
  frameId: number,
  type: Type,
  request: ToFrame[Type]['request'],
): Promise<Reply<ToFrame, Type>> {
  return browser.tabs.sendMessage(tabId, { type, ...request }, { frameId }) as Promise<Reply<ToFrame, Type>>;
}

/**
 * Listens for messages with async handlers. Chrome's `onMessage` answers asynchronously only through
 * `sendResponse` with the listener returning true, so a promise-returning handler is wrapped that way.
 */
export function listen<Message extends { type: string }>(
  handler: (message: Message, sender: Browser.runtime.MessageSender) => Promise<unknown> | undefined,
  accepts: (message: { type?: unknown }) => boolean,
): void {
  browser.runtime.onMessage.addListener((message: { type?: unknown }, sender, sendResponse) => {
    if (!accepts(message)) return false;
    const result = handler(message as Message, sender);
    if (!result) return false;
    result.then(
      (value) => sendResponse(value),
      (error: unknown) => {
        console.error('[outbox]', (message as Message).type, error);
        sendResponse(undefined);
      },
    );
    return true;
  });
}
