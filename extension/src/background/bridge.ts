import type { ExtensionReadiness } from '@domain/bridge';
import { OUTBOX_MATCHES } from '../hosts';
import type { ToBackground } from '../messages';
import { apiKeyItem, getSettings } from '../storage';
import { NoApiKey, parseResume } from './ai';

/** Only Outbox's own pages may ask the extension to spend the owner's key. */
export function fromOutbox(url: string | undefined): boolean {
  return !!url && OUTBOX_MATCHES.some((pattern) => url.startsWith(pattern.replace(/\*$/, '')));
}

export async function readiness(): Promise<ExtensionReadiness> {
  const [key, settings] = await Promise.all([apiKeyItem.getValue(), getSettings()]);
  if (!settings.aiEnabled) return 'ai-off';
  return key ? 'ready' : 'no-key';
}

/** Reads a resume for Outbox's profile page. */
export async function readResumeForOutbox(pdf: string): Promise<ToBackground['resume:parse']['response']> {
  const ready = await readiness();
  if (ready !== 'ready') return { ok: false, error: ready, detail: '' };
  try {
    const facts = await parseResume(pdf);
    return facts
      ? { ok: true, facts }
      : { ok: false, error: 'failed', detail: 'The model could not read it.' };
  } catch (error) {
    if (error instanceof NoApiKey) return { ok: false, error: 'no-key', detail: '' };
    return { ok: false, error: 'failed', detail: error instanceof Error ? error.message : String(error) };
  }
}
