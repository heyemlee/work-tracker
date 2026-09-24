import type {
  AccountColor,
  Application,
  Company,
  Id,
  IsoDate,
  Job,
  Snapshot,
  Stage,
  TimelineEvent,
} from '../domain/types';

export interface QuickAddInput {
  companyName: string;
  title: string | null;
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
  notes?: string;
}

/** Everything a job deletion removed, so it can be restored. */
export interface DeletedJob {
  job: Job;
  /** Set when the company had no other jobs and was removed too. */
  company: Company | null;
  applications: Application[];
  events: TimelineEvent[];
}

export interface AccountInput {
  id?: Id;
  label: string;
  email: string;
  color: AccountColor;
}

/**
 * The UI talks to data only through this interface: a browser-local implementation backs the prototype, and
 * the Worker API will implement it for the MVP.
 */
export interface Repository {
  load(): Promise<Snapshot>;

  quickAdd(input: QuickAddInput): Promise<QuickAddResult>;
  undoQuickAdd(result: QuickAddResult): Promise<void>;

  addApplication(input: NewApplication): Promise<Id>;
  removeApplication(id: Id): Promise<void>;
  setStage(id: Id, stage: Stage): Promise<void>;
  setRejected(id: Id, rejected: boolean): Promise<void>;
  updateApplication(id: Id, patch: ApplicationPatch): Promise<void>;

  updateJob(id: Id, patch: JobPatch): Promise<void>;
  deleteJob(id: Id): Promise<DeletedJob>;
  restoreJob(deleted: DeletedJob): Promise<void>;

  saveAccount(input: AccountInput): Promise<Id>;
  /** Rejects when the account has applications — they must keep pointing at a real identity. */
  deleteAccount(id: Id): Promise<void>;
  saveResume(input: { id?: Id; name: string }): Promise<Id>;
  deleteResume(id: Id): Promise<void>;
  saveChannel(input: { id?: Id; name: string }): Promise<Id>;
  deleteChannel(id: Id): Promise<void>;

  /** Prototype only: discard local changes and regenerate the sample data. */
  resetSampleData(): Promise<void>;
}
