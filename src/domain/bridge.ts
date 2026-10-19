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

/** The extension's settings, section by section: Outbox's own settings window shows them one at a time. */
export const EXTENSION_SECTIONS = ['connection', 'ai', 'reports', 'memory', 'general'] as const;
export type ExtensionSection = (typeof EXTENSION_SECTIONS)[number];

export type PageMessage =
  | {
      source: typeof FROM_PAGE;
      type: 'ping';
      /** Outbox's language, which the extension's follows unless one is chosen there. Absent before 2026-10-19. */
      locale?: 'en' | 'zh';
    }
  /** Opens the extension's settings in a window of its own over the page: for builds that can't do what follows. */
  | { source: typeof FROM_PAGE; type: 'open-options' }
  /** The extension's settings, for a frame inside Outbox's own settings window: one section, light or dark. */
  | { source: typeof FROM_PAGE; type: 'settings-frame'; id: string; section: ExtensionSection; dark: boolean }
  | {
      source: typeof FROM_PAGE;
      type: 'parse-resume';
      id: string;
      pdf: string;
      /** The PDF's text, read in the page; empty for a scan. Models that can't open a PDF read this. */
      text: string;
    };

export type ExtensionMessage =
  | {
      source: typeof FROM_EXTENSION;
      type: 'hello';
      readiness: ExtensionReadiness;
      /** Absent from builds before 2026-09-28, as is `logged`. */
      version?: string;
      /** It has logged an application to Outbox at least once. */
      logged?: boolean;
    }
  /** The address of the frame asked for: the extension's settings page, on a ticket good for one showing. */
  | { source: typeof FROM_EXTENSION; type: 'settings-frame'; id: string; url: string }
  | { source: typeof FROM_EXTENSION; type: 'parse-result'; id: string; facts: unknown }
  | { source: typeof FROM_EXTENSION; type: 'parse-error'; id: string; error: ParseError; detail: string };

/**
 * Between Outbox's settings window and the extension's settings page in the frame inside it, over the frame's own
 * `postMessage`. The page says it drew, and asks to be closed (Escape); the window says which section to show, on
 * which side of light and dark, and that it's closing, so that a field still being typed in is kept first.
 */
export type FromSettingsFrame = { source: typeof FROM_EXTENSION; type: 'settings-shown' | 'settings-close' };

export type ToSettingsFrame =
  | { type: 'settings:closing' }
  | { type: 'settings:section'; section: ExtensionSection }
  | { type: 'settings:scheme'; dark: boolean };

/** A resume PDF of up to 5 MB, as base64. */
export const MAX_RESUME_BASE64 = Math.ceil((5 * 1024 * 1024 * 4) / 3);

/** A resume's text, capped well above any real resume. */
export const MAX_RESUME_TEXT = 60_000;
