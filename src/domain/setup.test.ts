import { describe, expect, it } from 'vitest';
import { emptyProfile } from './profile';
import { hideNudge, nextStep, nudgeShown, setupProgress, type SetupFacts } from './setup';

const blank: SetupFacts = {
  accounts: 0,
  resumes: 0,
  extensionReady: false,
  profile: null,
  extensionLogged: false,
};

describe('setupProgress', () => {
  it('starts with nothing done', () => {
    const progress = setupProgress(blank);
    expect(Object.values(progress).some(Boolean)).toBe(false);
    expect(nextStep(progress)).toBe('accounts');
  });

  it('counts a profile once a resume filled its history', () => {
    const profile = emptyProfile();
    expect(setupProgress({ ...blank, profile }).profile).toBe(false);
    profile.experience.push({
      company: 'Example Co.',
      title: 'Software Engineer',
      location: '',
      type: 'full-time',
      start: '2022-06',
      end: null,
      description: '',
    });
    expect(setupProgress({ ...blank, profile }).profile).toBe(true);
  });

  it('takes a citizenship as the rules-only answers being done', () => {
    const profile = emptyProfile();
    profile.workAuthorization.citizenship = ['China'];
    expect(setupProgress({ ...blank, profile }).authorization).toBe(true);
  });

  it('is finished when the extension has logged an application', () => {
    const profile = emptyProfile();
    profile.education.push({
      school: 'Example University',
      degree: 'M.S.',
      level: 'master',
      field: 'Computer Science',
      start: '2024-08',
      end: '2026-05',
      gpa: '',
      location: '',
    });
    profile.workAuthorization.citizenship = ['China'];
    const progress = setupProgress({
      accounts: 2,
      resumes: 1,
      extensionReady: true,
      profile,
      extensionLogged: true,
    });
    expect(nextStep(progress)).toBeNull();
  });
});

describe('nudge', () => {
  const now = new Date('2026-09-28T12:00:00.000Z');

  it('comes back a week after the first hide', () => {
    const once = hideNudge({ hides: 0, hiddenUntil: null }, now);
    expect(nudgeShown(once, new Date('2026-10-05T11:59:00.000Z'))).toBe(false);
    expect(nudgeShown(once, new Date('2026-10-05T12:00:00.000Z'))).toBe(true);
  });

  it('stays hidden after the second hide', () => {
    const twice = hideNudge(hideNudge({ hides: 0, hiddenUntil: null }, now), now);
    expect(nudgeShown(twice, new Date('2027-01-01T00:00:00.000Z'))).toBe(false);
  });
});
