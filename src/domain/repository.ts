import type { Profile, SavedProfile } from './profile';
import type { AccountColor, Id, IsoDate, Snapshot, Stage, TimelineEvent } from './types';

export interface QuickAddInput {
  companyName: string;
  title: string | null;
  /** The posting's link. A new job stores it; an existing job gets it only if it has none. */
  url: string | null;
  /** Attach the new applications to this job instead of creating one. */
  jobId: Id | null;
  /** No accounts means "save the job for later". */
  accountIds: Id[];
  channelId: Id | null;
  resumeId: Id | null;
  appliedAt: IsoDate;
}

/** What a quick-add created, so it can be undone. */
export interface QuickAddResult {
  jobId: Id;
  createdJobId: Id | null;
  createdCompanyId: Id | null;
  applicationIds: Id[];
}

export interface NewApplication {
  jobId: Id;
  accountId: Id;
  channelId: Id | null;
  resumeId: Id | null;
  appliedAt: IsoDate;
}

export interface ApplicationPatch {
  channelId?: Id | null;
  resumeId?: Id | null;
  appliedAt?: IsoDate;
}

export interface JobPatch {
  title?: string | null;
  url?: string | null;
  notes?: string;
}

export interface AccountInput {
  id?: Id;
  label: string;
  email: string;
  color: AccountColor;
}

export interface NameInput {
  id?: Id;
  name: string;
}

/**
 * The contract between the UI and its data. The browser-local implementation backs the offline prototype;
 * the Worker implements it over D1, and the SPA reaches that one through HTTP. Both run the same contract tests.
 */
export interface Repository {
  load(): Promise<Snapshot>;
  /** A job's timeline, newest first. Loaded on demand to keep the snapshot small. */
  loadEvents(jobId: Id): Promise<TimelineEvent[]>;

  quickAdd(input: QuickAddInput): Promise<QuickAddResult>;
  undoQuickAdd(result: QuickAddResult): Promise<void>;

  addApplication(input: NewApplication): Promise<Id>;
  removeApplication(id: Id): Promise<void>;
  setStage(id: Id, stage: Stage): Promise<void>;
  setRejected(id: Id, rejected: boolean): Promise<void>;
  updateApplication(id: Id, patch: ApplicationPatch): Promise<void>;

  updateJob(id: Id, patch: JobPatch): Promise<void>;
  /** Soft delete: the job disappears but can be restored. */
  deleteJob(id: Id): Promise<void>;
  restoreJob(id: Id): Promise<void>;

  saveAccount(input: AccountInput): Promise<Id>;
  /** Rejects with a ConflictError while the account has applications — they must keep pointing at an identity. */
  deleteAccount(id: Id): Promise<void>;
  saveResume(input: NameInput): Promise<Id>;
  deleteResume(id: Id): Promise<void>;
  saveChannel(input: NameInput): Promise<Id>;
  deleteChannel(id: Id): Promise<void>;

  /** The autofill extension's profile; null until it is first saved. */
  loadProfile(): Promise<SavedProfile | null>;
  /** Replaces the whole profile. Callers validate it first; the Worker does so on every request. */
  saveProfile(profile: Profile): Promise<SavedProfile>;
}
