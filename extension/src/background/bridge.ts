import type { ExtensionReadiness } from '@domain/bridge';
import { OUTBOX_MATCHES } from '../hosts';
import type { ToBackground } from '../messages';
import { aiKey, getSettings } from '../storage';
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

/** Reads a resume for Outbox's profile page. */
export async function readResumeForOutbox(
  pdf: string,
  text: string,
): Promise<ToBackground['resume:parse']['response']> {
  const ready = await readiness();
  if (ready !== 'ready') return { ok: false, error: ready, detail: '' };
  try {
    const facts = await parseResume(pdf, text);
    if (!facts) return { ok: false, error: 'failed', detail: 'The model could not read it.' };
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
