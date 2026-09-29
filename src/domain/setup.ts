import type { Profile } from './profile';
import type { IsoDateTime } from './types';

/** What setting up takes, in the order the guide asks for it. */
export const SETUP_STEPS = [
  'accounts',
  'resumes',
  'extension',
  'profile',
  'authorization',
  'firstApplication',
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Where each step is done: its step in the setup guide, counted from 1. */
export const GUIDE_STEP: Record<SetupStep, number> = {
  accounts: 1,
  resumes: 2,
  extension: 3,
  profile: 4,
  authorization: 5,
  // Done by applying; the guide's last step says how.
  firstApplication: 6,
};

export interface SetupFacts {
  accounts: number;
  /** Resume versions with a PDF. */
  resumes: number;
  /** The extension has been ready to read resumes on Outbox, now or on an earlier visit. */
  extensionReady: boolean;
  /** The saved profile, or null before the first save. */
  profile: Profile | null;
  /** The extension has logged an application, now or on an earlier visit. */
  extensionLogged: boolean;
}

export function setupProgress({
  accounts,
  resumes,
  extensionReady,
  profile,
  extensionLogged,
}: SetupFacts): Record<SetupStep, boolean> {
  return {
    accounts: accounts > 0,
    resumes: resumes > 0,
    extension: extensionReady,
    profile: profile !== null && (profile.education.length > 0 || profile.experience.length > 0),
    // Citizenship is never on a resume: set, it means the owner went through the rules-only answers.
    authorization: profile !== null && profile.workAuthorization.citizenship.length > 0,
    firstApplication: extensionLogged,
  };
}

/** The first step not done yet, or null once everything is. */
export function nextStep(progress: Record<SetupStep, boolean>): SetupStep | null {
  return SETUP_STEPS.find((step) => !progress[step]) ?? null;
}

/** How the home page's checklist stays out of the way once it's been hidden. */
export interface Nudge {
  hides: number;
  hiddenUntil: IsoDateTime | null;
}

export const NUDGE_PAUSE_DAYS = 7;

/** Hidden once, the checklist comes back a week later; hidden twice, it stays hidden. */
export function nudgeShown(nudge: Nudge, now: Date): boolean {
  if (nudge.hides >= 2) return false;
  return nudge.hiddenUntil === null || now.getTime() >= Date.parse(nudge.hiddenUntil);
}

export function hideNudge(nudge: Nudge, now: Date): Nudge {
  return {
    hides: nudge.hides + 1,
    hiddenUntil: new Date(now.getTime() + NUDGE_PAUSE_DAYS * 86_400_000).toISOString(),
  };
}
