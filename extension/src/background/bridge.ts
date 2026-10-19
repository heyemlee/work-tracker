import type { ExtensionReadiness } from '@domain/bridge';
import { browser } from 'wxt/browser';
import { OUTBOX_MATCHES } from '../hosts';
import type { BridgeStatus, ToBackground } from '../messages';
import { aiKey, getSettings, loggedItem, outboxLanguageItem } from '../storage';
import { NoApiKey, parseResume } from './ai';

/** Only Outbox's own pages may ask the extension to spend the owner's key. */
export function fromOutbox(url: string | undefined): boolean {
  return !!url && OUTBOX_MATCHES.some((pattern) => url.startsWith(pattern.replace(/\*$/, '')));
}

export async function readiness(): Promise<ExtensionReadiness> {
  const [key, settings] = await Promise.all([aiKey(), getSettings()]);
  if (!settings.aiEnabled) return 'ai-off';
  return key ? 'ready' : 'no-key';
}

/** What Outbox's page shows about the extension: whether it can read resumes, its version, and whether it logged. */
export async function bridgeStatus(): Promise<BridgeStatus> {
  const [ready, logged] = await Promise.all([readiness(), loggedItem.getValue()]);
  return { readiness: ready, version: browser.runtime.getManifest().version, logged };
}

/**
 * Keeps the language Outbox's page shows, for the extension's own to follow. Its page says so each time it asks how
 * the extension is doing: written only when it changed.
 */
export async function followOutbox(language: 'en' | 'zh'): Promise<void> {
  if (language !== 'en' && language !== 'zh') return;
  if ((await outboxLanguageItem.getValue()) !== language) await outboxLanguageItem.setValue(language);
}

/** Reads a resume for Outbox's profile page. */
export async function readResumeForOutbox(
  pdf: string,
  text: string,
): Promise<ToBackground['resume:parse']['response']> {
  const ready = await readiness();
  if (ready !== 'ready') return { ok: false, error: ready, detail: '' };
  try {
    const facts = await parseResume(pdf, text);
    // An empty answer means the model never saw the resume, not that the resume is empty.
    const read = facts.name.first || facts.name.last || facts.education.length || facts.experience.length;
    if (!read)
      return {
        ok: false,
        error: 'failed',
        detail: text
          ? 'The model returned nothing from this resume.'
          : 'No text could be read from this PDF (a scan?), and the model returned nothing.',
      };
    return { ok: true, facts };
  } catch (error) {
    if (error instanceof NoApiKey) return { ok: false, error: 'no-key', detail: '' };
    return { ok: false, error: 'failed', detail: error instanceof Error ? error.message : String(error) };
  }
}
