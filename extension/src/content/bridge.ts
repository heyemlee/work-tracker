import {
  EXTENSION_SECTIONS,
  FROM_EXTENSION,
  FROM_PAGE,
  MAX_RESUME_BASE64,
  MAX_RESUME_TEXT,
  type ExtensionMessage,
  type ExtensionSection,
} from '@domain/bridge';
import type { BridgeStatus, ToBackground } from '../messages';

export interface BridgeBackend {
  status(): Promise<BridgeStatus | undefined>;
  parse(pdf: string, text: string): Promise<ToBackground['resume:parse']['response'] | undefined>;
  /** Shows the settings in a window of the extension's own; settles once they're closed. */
  openOptions(): Promise<void>;
  /** The settings' page and a ticket for it to draw on in a frame of Outbox's own settings window. */
  settingsFrame(): Promise<{ page: string; ticket: string } | undefined>;
  /** Keeps the language Outbox shows, for the extension's to follow. */
  language(language: 'en' | 'zh'): Promise<void>;
}

/**
 * Answers Outbox's page, which can't reach the extension itself: whether a resume can be read (and the version, and
 * whether an application was logged, for its setup checklist), the read resume, and the settings where the key goes,
 * for a frame in Outbox's own settings window. Its pings say which language it shows. Only messages from this window
 * and origin count. Returns a function that stops listening.
 */
export function startBridge(win: Window, backend: BridgeBackend): () => void {
  const origin = win.location.origin;
  const post = (message: ExtensionMessage) => win.postMessage(message, origin);
  const hello = () =>
    backend.status().then(
      (status) =>
        post({
          source: FROM_EXTENSION,
          type: 'hello',
          readiness: status?.readiness ?? 'no-key',
          version: status?.version ?? '',
          logged: status?.logged ?? false,
        }),
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
      locale?: unknown;
      section?: unknown;
      dark?: unknown;
    } | null;
    if (!data || data.source !== FROM_PAGE) return;
    if (data.type === 'ping') {
      if (data.locale === 'en' || data.locale === 'zh')
        void backend.language(data.locale).catch(() => undefined);
      void hello();
    }
    // What the settings changed (a key added, AI turned on) reaches the page as they close.
    if (data.type === 'open-options') void backend.openOptions().then(hello, () => undefined);
    if (data.type === 'settings-frame' && typeof data.id === 'string') {
      const id = data.id;
      const section = EXTENSION_SECTIONS.includes(data.section as ExtensionSection)
        ? (data.section as ExtensionSection)
        : 'connection';
      const hash = { embed: '1', section, dark: data.dark === true ? '1' : '0' };
      backend.settingsFrame().then(
        (frame) => {
          if (!frame) return;
          const url = `${frame.page}#${new URLSearchParams({ ticket: frame.ticket, ...hash })}`;
          post({ source: FROM_EXTENSION, type: 'settings-frame', id, url });
        },
        () => undefined,
      );
    }
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
