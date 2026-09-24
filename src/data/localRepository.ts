import { isBuiltinChannel } from '../domain/channels';
import {
  planAddApplication,
  planQuickAdd,
  planRejectedChange,
  planRemoveApplication,
  planStageChange,
  systemClock,
  type ApplicationChange,
  type Clock,
} from '../domain/commands';
import { findCompany } from '../domain/companies';
import { ConflictError, NotFoundError } from '../domain/errors';
import type { Repository } from '../domain/repository';
import type { Application, Id, Job } from '../domain/types';
import { createSampleData, type SampleData } from '../domain/sampleData';

const STORAGE_KEY = 'outbox.sample.v3';

/** Everything the local repository keeps: the data, every timeline, and which jobs are soft-deleted. */
interface LocalState extends SampleData {
  deletedJobIds: Id[];
}

export interface LocalRepository extends Repository {
  /** Discards local changes and regenerates the sample data. */
  resetSampleData(): Promise<void>;
}

interface Options {
  /** Where to persist. Null keeps everything in memory. */
  storage?: Storage | null;
  /** Starting data when storage is empty. */
  initial?: () => SampleData;
  clock?: Clock;
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The offline implementation: the whole dataset lives in memory and is mirrored to localStorage. */
export function createLocalRepository({
  storage = browserStorage(),
  initial = () => createSampleData(new Date()),
  clock = systemClock,
}: Options = {}): LocalRepository {
  const fresh = (): LocalState => ({ ...initial(), deletedJobIds: [] });

  const read = (): LocalState | null => {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as LocalState) : null;
    } catch {
      return null;
    }
  };

  let state = read() ?? fresh();

  const commit = (next: LocalState) => {
    state = next;
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode or a full quota: keep working in memory.
    }
  };

  const isDeleted = (jobId: Id) => state.deletedJobIds.includes(jobId);

  const liveJob = (id: Id): Job => {
    const job = state.jobs.find((j) => j.id === id);
    if (!job || isDeleted(id)) throw new NotFoundError('Job', id);
    return job;
  };

  const liveApplication = (id: Id): Application => {
    const app = state.applications.find((a) => a.id === id);
    if (!app || isDeleted(app.jobId)) throw new NotFoundError('Application', id);
    return app;
  };

  const requireAccount = (id: Id) => {
    if (!state.accounts.some((a) => a.id === id)) throw new NotFoundError('Account', id);
  };

  const applyChange = (change: ApplicationChange | null) => {
    if (!change) return;
    commit({
      ...state,
      applications: state.applications.map((a) => (a.id === change.application.id ? change.application : a)),
      events: [...state.events, change.event],
    });
  };

  return {
    async load() {
      return {
        accounts: state.accounts,
        resumes: state.resumes,
        channels: state.channels,
        companies: state.companies,
        jobs: state.jobs.filter((j) => !isDeleted(j.id)),
        applications: state.applications.filter((a) => !isDeleted(a.jobId)),
      };
    },

    async loadEvents(jobId) {
      liveJob(jobId);
      // Newest first; among same-instant events, the one recorded last comes first.
      return state.events
        .filter((e) => e.jobId === jobId)
        .reverse()
        .sort((a, b) => b.at.localeCompare(a.at));
    },

    async quickAdd(input) {
      if (input.jobId) liveJob(input.jobId);
      input.accountIds.forEach(requireAccount);
      const plan = planQuickAdd(
        input,
        {
          existingCompany: findCompany(state.companies, input.companyName),
          takenAccountIds: new Set(
            state.applications.filter((a) => a.jobId === input.jobId).map((a) => a.accountId),
          ),
        },
        clock,
      );
      commit({
        ...state,
        companies: plan.company ? [...state.companies, plan.company] : state.companies,
        jobs: plan.job ? [...state.jobs, plan.job] : state.jobs,
        applications: [...state.applications, ...plan.applications],
        events: [...state.events, ...plan.events],
      });
      return plan.result;
    },

    async undoQuickAdd({ createdJobId, createdCompanyId, applicationIds }) {
      const removed = new Set(applicationIds);
      const companyStillUsed = state.jobs.some(
        (j) => j.companyId === createdCompanyId && j.id !== createdJobId,
      );
      commit({
        ...state,
        companies: companyStillUsed
          ? state.companies
          : state.companies.filter((c) => c.id !== createdCompanyId),
        jobs: state.jobs.filter((j) => j.id !== createdJobId),
        applications: state.applications.filter((a) => !removed.has(a.id)),
        events: state.events.filter(
          (e) => e.jobId !== createdJobId && !(e.applicationId && removed.has(e.applicationId)),
        ),
      });
    },

    async addApplication(input) {
      liveJob(input.jobId);
      requireAccount(input.accountId);
      if (state.applications.some((a) => a.jobId === input.jobId && a.accountId === input.accountId)) {
        throw new ConflictError('This account already applied to this job');
      }
      const { application, event } = planAddApplication(input, clock);
      commit({
        ...state,
        applications: [...state.applications, application],
        events: [...state.events, event],
      });
      return application.id;
    },

    async removeApplication(id) {
      const app = liveApplication(id);
      commit({
        ...state,
        applications: state.applications.filter((a) => a.id !== id),
        events: [...state.events, planRemoveApplication(app, clock)],
      });
    },

    async setStage(id, stage) {
      applyChange(planStageChange(liveApplication(id), stage, clock));
    },

    async setRejected(id, rejected) {
      applyChange(planRejectedChange(liveApplication(id), rejected, clock));
    },

    async updateApplication(id, patch) {
      liveApplication(id);
      const updatedAt = clock.now();
      commit({
        ...state,
        applications: state.applications.map((a) => (a.id === id ? { ...a, ...patch, updatedAt } : a)),
      });
    },

    async updateJob(id, patch) {
      liveJob(id);
      const updatedAt = clock.now();
      commit({ ...state, jobs: state.jobs.map((j) => (j.id === id ? { ...j, ...patch, updatedAt } : j)) });
    },

    async deleteJob(id) {
      liveJob(id);
      commit({ ...state, deletedJobIds: [...state.deletedJobIds, id] });
    },

    async restoreJob(id) {
      if (!isDeleted(id)) throw new NotFoundError('Deleted job', id);
      commit({ ...state, deletedJobIds: state.deletedJobIds.filter((jobId) => jobId !== id) });
    },

    async saveAccount({ id, label, email, color }) {
      if (id) {
        requireAccount(id);
        commit({
          ...state,
          accounts: state.accounts.map((a) => (a.id === id ? { ...a, label, email, color } : a)),
        });
        return id;
      }
      const account = { id: clock.newId('acc'), label, email, color, createdAt: clock.now() };
      commit({ ...state, accounts: [...state.accounts, account] });
      return account.id;
    },

    async deleteAccount(id) {
      if (state.applications.some((a) => a.accountId === id)) throw new ConflictError('Account is in use');
      commit({ ...state, accounts: state.accounts.filter((a) => a.id !== id) });
    },

    async saveResume({ id, name }) {
      if (id) {
        commit({ ...state, resumes: state.resumes.map((r) => (r.id === id ? { ...r, name } : r)) });
        return id;
      }
      const resume = { id: clock.newId('res'), name, createdAt: clock.now() };
      commit({ ...state, resumes: [...state.resumes, resume] });
      return resume.id;
    },

    async deleteResume(id) {
      commit({
        ...state,
        resumes: state.resumes.filter((r) => r.id !== id),
        applications: state.applications.map((a) => (a.resumeId === id ? { ...a, resumeId: null } : a)),
      });
    },

    async saveChannel({ id, name }) {
      if (id) {
        if (isBuiltinChannel(id)) throw new ConflictError('Built-in channels cannot be renamed');
        commit({ ...state, channels: state.channels.map((c) => (c.id === id ? { ...c, name } : c)) });
        return id;
      }
      const channel = { id: clock.newId('ch'), name, builtin: false };
      commit({ ...state, channels: [...state.channels, channel] });
      return channel.id;
    },

    async deleteChannel(id) {
      if (isBuiltinChannel(id)) throw new ConflictError('Built-in channels cannot be deleted');
      commit({
        ...state,
        channels: state.channels.filter((c) => c.id !== id),
        applications: state.applications.map((a) => (a.channelId === id ? { ...a, channelId: null } : a)),
      });
    },

    async resetSampleData() {
      commit(fresh());
    },
  };
}
