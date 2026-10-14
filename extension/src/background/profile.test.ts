import type { SavedProfile } from '@domain/profile';
import type { Snapshot } from '@domain/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { makeProfile } from '../test/profiles';

class OutboxSignedOut extends Error {}
const loadSnapshot = vi.fn<() => Promise<Snapshot>>();
const syncProfile = vi.fn<() => Promise<SavedProfile | null>>();
const saveProfile = vi.fn<(profile: unknown) => Promise<SavedProfile>>();
vi.mock('./outbox', () => ({ loadSnapshot, syncProfile, saveProfile, OutboxSignedOut }));

const { loadProfile, storeProfile } = await import('./profile');
const { updateSession } = await import('./session');
const { profileItem } = await import('../storage');

const TAB = 7;
const URL_ = 'https://job-boards.greenhouse.io/arcadia/jobs/42';
const AT = '2026-10-06T12:00:00.000Z';
const empty: Snapshot = {
  accounts: [],
  resumes: [],
  channels: [],
  companies: [],
  jobs: [],
  applications: [],
};

beforeEach(() => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  loadSnapshot.mockResolvedValue(empty);
});

describe('opening the profile to edit', () => {
  it('takes Outbox’s copy', async () => {
    const profile = makeProfile();
    syncProfile.mockResolvedValue({ profile, updatedAt: AT });
    expect(await loadProfile()).toEqual({ profile, blank: false, outbox: 'connected' });
  });

  it('starts from a blank when nothing was saved yet', async () => {
    syncProfile.mockResolvedValue(null);
    const draft = await loadProfile();
    expect(draft.blank).toBe(true);
    expect(draft.profile.name.first).toBe('');
  });

  it('falls back on this browser’s copy, and says Outbox can’t take a save', async () => {
    const profile = makeProfile();
    await profileItem.setValue(profile);
    syncProfile.mockRejectedValue(new OutboxSignedOut());
    expect(await loadProfile()).toEqual({ profile, blank: false, outbox: 'signedOut' });
    syncProfile.mockRejectedValue(new Error('offline'));
    expect((await loadProfile()).outbox).toBe('unreachable');
  });
});

describe('saving the profile', () => {
  it('keeps what doesn’t hold as a profile from Outbox, and says where it doesn’t', async () => {
    const profile = makeProfile();
    const reply = await storeProfile(TAB, { ...profile, name: { ...profile.name, first: ' ' } });
    expect(reply).toMatchObject({ ok: false, error: 'invalid', issues: [{ path: ['name', 'first'] }] });
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('saves to Outbox and answers with the card’s new state', async () => {
    const profile = { ...makeProfile(), phone: '+1 408-555-0199' };
    saveProfile.mockResolvedValue({ profile, updatedAt: AT });
    await profileItem.setValue(profile);
    await updateSession(TAB, URL_, () => ({ hasForm: true }));
    const reply = await storeProfile(TAB, profile);
    expect(saveProfile).toHaveBeenCalledWith(profile);
    expect(reply).toMatchObject({
      ok: true,
      profile,
      state: { profile: { name: `${profile.name.first} ${profile.name.last}` } },
    });
  });

  it('takes back the card’s word that there’s no profile', async () => {
    const profile = makeProfile();
    saveProfile.mockResolvedValue({ profile, updatedAt: AT });
    await profileItem.setValue(profile);
    // A fill was asked for before there was a profile.
    await updateSession(TAB, URL_, () => ({ hasForm: true, error: 'profile' }));
    const reply = await storeProfile(TAB, profile);
    expect(reply).toMatchObject({ ok: true, state: { error: null } });
  });

  it('says so when Outbox didn’t take it', async () => {
    saveProfile.mockRejectedValue(new OutboxSignedOut());
    expect(await storeProfile(TAB, makeProfile())).toEqual({ ok: false, error: 'signedOut', issues: [] });
    saveProfile.mockRejectedValue(new Error('offline'));
    expect(await storeProfile(TAB, makeProfile())).toEqual({ ok: false, error: 'unreachable', issues: [] });
  });
});
