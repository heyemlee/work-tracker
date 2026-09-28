/**
 * Messages between Outbox's pages and the autofill extension's content script on them, over `window.postMessage`.
 * The page asks and the extension answers; each side only listens to its own window and origin. The extension holds
 * the Anthropic key, so reading a resume runs there and only the result comes back.
 */
export const FROM_PAGE = 'outbox-page';
export const FROM_EXTENSION = 'outbox-autofill';

/** Whether the extension can read a resume: it needs its API key, and AI turned on. */
export type ExtensionReadiness = 'ready' | 'no-key' | 'ai-off';

export type ParseError = 'no-key' | 'ai-off' | 'too-large' | 'failed';

export type PageMessage =
  | { source: typeof FROM_PAGE; type: 'ping' }
  | {
      source: typeof FROM_PAGE;
      type: 'parse-resume';
      id: string;
      pdf: string;
      /** The PDF's text, read in the page; empty for a scan. Models that can't open a PDF read this. */
      text: string;
    };

export type ExtensionMessage =
  | { source: typeof FROM_EXTENSION; type: 'hello'; readiness: ExtensionReadiness }
  | { source: typeof FROM_EXTENSION; type: 'parse-result'; id: string; facts: unknown }
  | { source: typeof FROM_EXTENSION; type: 'parse-error'; id: string; error: ParseError; detail: string };

/** A resume PDF of up to 5 MB, as base64. */
export const MAX_RESUME_BASE64 = Math.ceil((5 * 1024 * 1024 * 4) / 3);

/** A resume's text, capped well above any real resume. */
export const MAX_RESUME_TEXT = 60_000;
