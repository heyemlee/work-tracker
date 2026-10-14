import type { ProfileDraft, ProfileSaved } from '../messages';
import { emptyProfile, profileSchema } from '../profile/schema';
import { profileItem } from '../storage';
import { cardState } from './card';
import { OutboxSignedOut, saveProfile, syncProfile } from './outbox';
import { getSession, updateSession } from './session';

/**
 * The profile for the card's own window to edit: fresh from Outbox, or this browser's copy when Outbox can't be
 * reached; a blank before the first save.
 */
export async function loadProfile(): Promise<ProfileDraft> {
  try {
    const saved = await syncProfile();
    return { profile: saved?.profile ?? emptyProfile(), blank: !saved, outbox: 'connected' };
  } catch (error) {
    const kept = await profileItem.getValue();
    return {
      profile: kept ?? emptyProfile(),
      blank: !kept,
      outbox: error instanceof OutboxSignedOut ? 'signedOut' : 'unreachable',
    };
  }
}

/**
 * Saves what the owner edited, if it holds as a profile. It goes to Outbox, which keeps it; a save Outbox didn't
 * take isn't kept here either, or the next sync would quietly undo it.
 */
export async function storeProfile(tabId: number | undefined, input: unknown): Promise<ProfileSaved> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: 'invalid',
      issues: parsed.error.issues.map(({ path, code }) => ({
        path: path.map((part) => (typeof part === 'number' ? part : String(part))),
        code,
      })),
    };
  try {
    const { profile } = await saveProfile(parsed.data);
    // A fill turned down for want of a profile said so on the card: there is one now.
    const session =
      tabId === undefined || !(await getSession(tabId))
        ? null
        : await updateSession(tabId, '', (current) => ({
            error: current.error === 'profile' ? null : current.error,
          }));
    return { ok: true, profile, state: session ? await cardState(session) : null };
  } catch (error) {
    return { ok: false, error: error instanceof OutboxSignedOut ? 'signedOut' : 'unreachable', issues: [] };
  }
}
