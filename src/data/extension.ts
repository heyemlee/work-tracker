import { useEffect, useSyncExternalStore } from 'react';
import {
  FROM_EXTENSION,
  FROM_PAGE,
  MAX_RESUME_BASE64,
  MAX_RESUME_TEXT,
  type ExtensionMessage,
  type ExtensionReadiness,
  type PageMessage,
  type ParseError,
} from '../domain/bridge';
import { resumeFactsSchema, type ResumeFacts } from '../domain/profile';
import { bytesToBase64 } from '../domain/resumes';
import { getPrefs, subscribePrefs, updateSetup } from '../state/prefs';
import { pdfText } from './pdfText';

/** Whether the autofill extension runs on this page, and whether it can read a resume. */
export type ExtensionState = 'checking' | 'missing' | ExtensionReadiness;

export class ExtensionError extends Error {
  readonly code: ParseError | 'timeout';
  readonly detail: string;

  constructor(code: ParseError | 'timeout', detail = '') {
    super(detail || code);
    this.name = 'ExtensionError';
    this.code = code;
    this.detail = detail;
  }
}

function fromExtension(event: MessageEvent): ExtensionMessage | null {
  if (event.source !== window || event.origin !== window.location.origin) return null;
  const data = event.data as { source?: unknown } | null;
  return data?.source === FROM_EXTENSION ? (data as ExtensionMessage) : null;
}

const send = (message: PageMessage) => window.postMessage(message, window.location.origin);

export interface ExtensionInfo {
  state: ExtensionState;
  /** The extension's version, from builds that say it. */
  version: string | null;
  /** It has logged an application to Outbox at least once. */
  logged: boolean;
}

// One shared view of the extension for every part of the page, kept fresh by asking again whenever Outbox is
// looked at again: the owner may have just installed it, or added its key, in another tab.
let info: ExtensionInfo = { state: 'checking', version: null, logged: false };
const listeners = new Set<() => void>();
let started = false;
let awaiting = 0;

function set(next: ExtensionInfo) {
  info = next;
  for (const listener of listeners) listener();
}

/**
 * Asks the extension to say hello, and tells it the language Outbox shows, for its own to follow. Silence means it
 * isn't running on this page.
 */
function check() {
  send({ source: FROM_PAGE, type: 'ping', locale: getPrefs().locale });
  window.clearTimeout(awaiting);
  awaiting = window.setTimeout(() => {
    if (info.state !== 'missing') set({ ...info, state: 'missing' });
  }, 1500);
}

function start() {
  if (started) return;
  started = true;
  window.addEventListener('message', (event) => {
    const message = fromExtension(event);
    if (message?.type !== 'hello') return;
    window.clearTimeout(awaiting);
    set({ state: message.readiness, version: message.version ?? null, logged: message.logged ?? false });
    // Remembered, so the setup checklist keeps these done on devices without the extension.
    const { setup } = getPrefs();
    if (message.readiness === 'ready' && !setup.extensionReady) updateSetup({ extensionReady: true });
    if (message.logged && !setup.extensionLogged) updateSetup({ extensionLogged: true });
  });
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check();
  });
  // Another language chosen: the extension's follows at once.
  let locale = getPrefs().locale;
  subscribePrefs(() => {
    if (getPrefs().locale === locale) return;
    locale = getPrefs().locale;
    check();
  });
  check();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether the autofill extension runs on this page and can read a resume. With `watch`, it asks every couple of
 * seconds, for a page that waits on the owner to install it or add a key.
 */
export function useExtension({ watch = false }: { watch?: boolean } = {}): ExtensionInfo {
  useEffect(() => {
    start();
    if (!watch) return;
    const timer = window.setInterval(check, 2000);
    return () => window.clearInterval(timer);
  }, [watch]);
  return useSyncExternalStore(subscribe, () => info);
}

/** Has the extension show its settings, in a window of its own over this page. Does nothing without the extension. */
export function openExtensionOptions(): void {
  send({ source: FROM_PAGE, type: 'open-options' });
}

/** Has the extension read a resume PDF with the owner's key. Takes up to a minute or so. */
export async function readResumeWithExtension(file: File): Promise<ResumeFacts> {
  const pdf = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  if (pdf.length > MAX_RESUME_BASE64) throw new ExtensionError('too-large');
  // Not every provider passes a PDF on to its model; the text reaches any of them.
  const text = await pdfText(file).catch(() => '');
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let timer = 0;
    const onMessage = (event: MessageEvent) => {
      const message = fromExtension(event);
      if (!message || message.type === 'hello' || message.id !== id) return;
      finish();
      if (message.type === 'parse-error') return reject(new ExtensionError(message.error, message.detail));
      const facts = resumeFactsSchema.safeParse(message.facts);
      if (facts.success) resolve(facts.data);
      else reject(new ExtensionError('failed', 'unexpected answer from the extension'));
    };
    const finish = () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
    };
    timer = window.setTimeout(() => {
      finish();
      reject(new ExtensionError('timeout'));
    }, 180_000);
    window.addEventListener('message', onMessage);
    send({ source: FROM_PAGE, type: 'parse-resume', id, pdf, text: text.slice(0, MAX_RESUME_TEXT) });
  });
}
