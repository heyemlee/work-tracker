import {
  FROM_EXTENSION,
  FROM_PAGE,
  MAX_RESUME_BASE64,
  MAX_RESUME_TEXT,
  type ExtensionMessage,
  type ExtensionReadiness,
} from '@domain/bridge';
import type { ToBackground } from '../messages';

export interface BridgeBackend {
  readiness(): Promise<ExtensionReadiness | undefined>;
  parse(pdf: string, text: string): Promise<ToBackground['resume:parse']['response'] | undefined>;
}

/**
 * Answers Outbox's page, which can't reach the extension itself: whether a resume can be read, and the read resume.
 * Only messages from this window and origin count. Returns a function that stops listening.
 */
export function startBridge(win: Window, backend: BridgeBackend): () => void {
  const origin = win.location.origin;
  const post = (message: ExtensionMessage) => win.postMessage(message, origin);
  const hello = () =>
    backend.readiness().then(
      (readiness) => post({ source: FROM_EXTENSION, type: 'hello', readiness: readiness ?? 'no-key' }),
      () => undefined,
    );

  const onMessage = (event: MessageEvent) => {
    if (event.source !== win || event.origin !== origin) return;
    const data = event.data as {
      source?: unknown;
      type?: unknown;
      id?: unknown;
      pdf?: unknown;
      text?: unknown;
    } | null;
    if (!data || data.source !== FROM_PAGE) return;
    if (data.type === 'ping') void hello();
    if (data.type !== 'parse-resume' || typeof data.id !== 'string' || typeof data.pdf !== 'string') return;
    const id = data.id;
    const fail = (error: 'too-large' | 'failed' | 'no-key' | 'ai-off', detail = '') =>
      post({ source: FROM_EXTENSION, type: 'parse-error', id, error, detail });
    if (data.pdf.length > MAX_RESUME_BASE64) return fail('too-large');
    const text = typeof data.text === 'string' ? data.text.slice(0, MAX_RESUME_TEXT) : '';
    backend.parse(data.pdf, text).then(
      (reply) => {
        if (reply?.ok) post({ source: FROM_EXTENSION, type: 'parse-result', id, facts: reply.facts });
        else fail(reply?.error ?? 'failed', reply?.detail ?? '');
      },
      (error: unknown) => fail('failed', error instanceof Error ? error.message : String(error)),
    );
  };

  win.addEventListener('message', onMessage);
  void hello();
  return () => win.removeEventListener('message', onMessage);
}
