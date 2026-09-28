import { useEffect, useState } from 'react';
import {
  FROM_EXTENSION,
  FROM_PAGE,
  MAX_RESUME_BASE64,
  type ExtensionMessage,
  type ExtensionReadiness,
  type PageMessage,
  type ParseError,
} from '../domain/bridge';
import { resumeFactsSchema, type ResumeFacts } from '../domain/profile';

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

export function useExtension(): ExtensionState {
  const [state, setState] = useState<ExtensionState>('checking');
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = fromExtension(event);
      if (message?.type === 'hello') setState(message.readiness);
    };
    window.addEventListener('message', onMessage);
    send({ source: FROM_PAGE, type: 'ping' });
    // The content script answers within moments; silence means it isn't installed here.
    const timer = window.setTimeout(
      () => setState((current) => (current === 'checking' ? 'missing' : current)),
      1500,
    );
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
    };
  }, []);
  return state;
}

async function toBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** Has the extension read a resume PDF with the owner's key. Takes up to a minute or so. */
export async function readResumeWithExtension(file: File): Promise<ResumeFacts> {
  const pdf = await toBase64(file);
  if (pdf.length > MAX_RESUME_BASE64) throw new ExtensionError('too-large');
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
    send({ source: FROM_PAGE, type: 'parse-resume', id, pdf });
  });
}
