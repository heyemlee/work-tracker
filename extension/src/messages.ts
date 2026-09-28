import type { ExtensionReadiness, ParseError } from '@domain/bridge';
import type { ResumeFacts } from '@domain/profile';
import type { QuickAddResult } from '@domain/repository';
import type { AccountColor } from '@domain/types';
import { browser, type Browser } from 'wxt/browser';
import type { Answer, Ats, FieldStatus, FrameScan, PlannedField, Posting, Source } from './model';
import type { MatchReport } from './match/report';
import type { FormSnapshot } from './storage';

/** One line of the card's checklist. */
export interface ChecklistItem {
  fieldId: string;
  label: string;
  status: FieldStatus;
  note: string | null;
  /** What the field holds after filling. */
  value: string | null;
  critical: boolean;
  source: Source | null;
  /** The fill reached the page; false when the widget refused the answer. */
  applied: boolean;
}

export interface CardAccount {
  id: string;
  email: string;
  color: AccountColor;
  /** Already applied to this posting from this account. */
  applied: boolean;
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
  profileLoaded: boolean;
  accounts: CardAccount[];
  accountId: string | null;
  resumes: CardResume[];
  resumeId: string | null;
  match: MatchReport | null;
  /** Ashby and Workday merge candidates, so a second account on one posting shows up as a duplicate. */
  duplicateHint: boolean;
  checklist: ChecklistItem[];
  logged: { result: QuickAddResult; undone: boolean; manual: boolean } | null;
  ai: 'off' | 'noKey' | 'ready' | 'busy' | 'failed';
  error: string | null;
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
  'card:state': { request: { refresh: boolean }; response: CardState };
  'card:select': { request: { accountId?: string | null; resumeId?: string | null }; response: CardState };
  'card:fill': { request: Record<string, never>; response: CardState };
  'card:focus': { request: { fieldId: string }; response: void };
  'card:snapshot': { request: Record<string, never>; response: { saved: number } };
  'card:log': { request: Record<string, never>; response: CardState };
  'card:undo': { request: Record<string, never>; response: CardState };
  'card:options': { request: Record<string, never>; response: void };
  'submit:attempt': { request: { answers: CapturedAnswer[] }; response: void };
  'submit:confirmed': { request: { url: string }; response: void };
  'outbox:session': { request: { token: string | null }; response: void };
  'resume:read': {
    request: { resumeId: string };
    response: { name: string; type: string; base64: string } | null;
  };
  /** From Outbox's page, through its content script: can a resume be read? */
  'bridge:status': { request: Record<string, never>; response: ExtensionReadiness };
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
    response: Record<string, { ok: boolean; value?: string; error?: string }>;
  };
  'frame:options': { request: { fieldIds: string[] }; response: Record<string, string[]> };
  'frame:read': { request: { fieldIds: string[] }; response: CapturedAnswer[] };
  'frame:focus': { request: { fieldId: string }; response: boolean };
  'frame:snapshot': { request: { plan: PlannedField[] }; response: Omit<FormSnapshot, 'id' | 'at'> | null };
  'card:update': { request: { state: CardState }; response: void };
  /** The card answers true, so the service worker knows there is one. */
  'card:open': { request: Record<string, never>; response: boolean };
  'card:fill': { request: Record<string, never>; response: boolean };
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
  return browser.runtime.sendMessage({ type, ...request }) as Promise<Reply<ToBackground, Type>>;
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
