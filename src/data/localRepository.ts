import { findCompany } from '../domain/companies';
import type { Application, Id, Job, Snapshot, TimelineEvent } from '../domain/types';
import type { DeletedJob, Repository } from './repository';
import { createSampleData } from './sampleData';

const STORAGE_KEY = 'outbox.sample.v2';

function readStorage(): Snapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
}

function writeStorage(snapshot: Snapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private mode or a full quota: keep working in memory.
  }
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
const now = () => new Date().toISOString();

type NewEvent = Omit<TimelineEvent, 'id' | 'at' | 'actor'>;

/** Prototype repository: the whole snapshot lives in memory and is mirrored to localStorage. */
export function createLocalRepository(): Repository {
  let state: Snapshot = readStorage() ?? createSampleData(new Date());

  const commit = (next: Snapshot) => {
    state = next;
    writeStorage(next);
  };

  const event = (partial: NewEvent): TimelineEvent => ({
    id: newId('evt'),
    at: now(),
    actor: 'user',
    ...partial,
  });

  const application = (id: Id): Application => {
    const found = state.applications.find((a) => a.id === id);
    if (!found) throw new Error(`Unknown application ${id}`);
    return found;
  };

  const patchApplication = (id: Id, patch: Partial<Application>): Application[] =>
    state.applications.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: now() } : a));

  return {
    async load() {
      return state;
    },

    async quickAdd(input) {
      const at = now();
      let { companies, jobs } = state;
      const events: TimelineEvent[] = [];
      let createdCompanyId: Id | null = null;
      let createdJobId: Id | null = null;

      let jobId = input.jobId;
      if (!jobId) {
        let company = findCompany(companies, input.companyName);
        if (!company) {
          company = { id: newId('co'), name: input.companyName.trim(), createdAt: at };
          companies = [...companies, company];
          createdCompanyId = company.id;
        }
        const job: Job = {
          id: newId('job'),
          companyId: company.id,
          title: input.title?.trim() || null,
          notes: '',
          createdAt: at,
          updatedAt: at,
        };
        jobs = [...jobs, job];
        jobId = createdJobId = job.id;
      }

      const targetJobId: Id = jobId;
      const taken = new Set(
        state.applications.filter((a) => a.jobId === targetJobId).map((a) => a.accountId),
      );
      const created = input.accountIds
        .filter((accountId) => !taken.has(accountId))
        .map((accountId): Application => ({
          id: newId('app'),
          jobId: targetJobId,
          accountId,
          channelId: input.channelId,
          resumeId: input.resumeId,
          stage: 'applied',
          rejected: false,
          appliedAt: input.appliedAt,
          source: 'user',
          createdAt: at,
          updatedAt: at,
        }));
      // "Job saved" only means something for a job saved without applying; otherwise "applied" says it all.
      if (createdJobId && created.length === 0) {
        events.push(
          event({
            jobId: targetJobId,
            applicationId: null,
            accountId: null,
            type: 'job_created',
            from: null,
            to: null,
          }),
        );
      }
      for (const app of created) {
        events.push(
          event({
            jobId: targetJobId,
            applicationId: app.id,
            accountId: app.accountId,
            type: 'applied',
            from: null,
            to: 'applied',
          }),
        );
      }

      commit({
        ...state,
        companies,
        jobs,
        applications: [...state.applications, ...created],
        events: [...state.events, ...events],
      });
      return { jobId: targetJobId, createdJobId, createdCompanyId, applicationIds: created.map((a) => a.id) };
    },

    async undoQuickAdd({ createdJobId, createdCompanyId, applicationIds }) {
      const removedApps = new Set(applicationIds);
      commit({
        ...state,
        companies: state.companies.filter((c) => c.id !== createdCompanyId),
        jobs: state.jobs.filter((j) => j.id !== createdJobId),
        applications: state.applications.filter((a) => !removedApps.has(a.id)),
        events: state.events.filter(
          (e) => e.jobId !== createdJobId && !(e.applicationId && removedApps.has(e.applicationId)),
        ),
      });
    },

    async addApplication(input) {
      if (state.applications.some((a) => a.jobId === input.jobId && a.accountId === input.accountId)) {
        throw new Error('This account already applied to this job');
      }
      const at = now();
      const app: Application = {
        id: newId('app'),
        ...input,
        stage: 'applied',
        rejected: false,
        source: 'user',
        createdAt: at,
        updatedAt: at,
      };
      commit({
        ...state,
        applications: [...state.applications, app],
        events: [
          ...state.events,
          event({
            jobId: app.jobId,
            applicationId: app.id,
            accountId: app.accountId,
            type: 'applied',
            from: null,
            to: 'applied',
          }),
        ],
      });
      return app.id;
    },

    async removeApplication(id) {
      const app = application(id);
      commit({
        ...state,
        applications: state.applications.filter((a) => a.id !== id),
        events: [
          ...state.events,
          event({
            jobId: app.jobId,
            applicationId: null,
            accountId: app.accountId,
            type: 'application_removed',
            from: app.stage,
            to: null,
          }),
        ],
      });
    },

    async setStage(id, stage) {
      const app = application(id);
      if (app.stage === stage) return;
      commit({
        ...state,
        applications: patchApplication(id, { stage }),
        events: [
          ...state.events,
          event({
            jobId: app.jobId,
            applicationId: id,
            accountId: app.accountId,
            type: 'stage_changed',
            from: app.stage,
            to: stage,
          }),
        ],
      });
    },

    async setRejected(id, rejected) {
      const app = application(id);
      if (app.rejected === rejected) return;
      commit({
        ...state,
        applications: patchApplication(id, { rejected }),
        events: [
          ...state.events,
          event({
            jobId: app.jobId,
            applicationId: id,
            accountId: app.accountId,
            type: rejected ? 'rejected' : 'unrejected',
            from: app.stage,
            to: app.stage,
          }),
        ],
      });
    },

    async updateApplication(id, patch) {
      application(id);
      commit({ ...state, applications: patchApplication(id, patch) });
    },

    async updateJob(id, patch) {
      commit({
        ...state,
        jobs: state.jobs.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: now() } : j)),
      });
    },

    async deleteJob(id) {
      const job = state.jobs.find((j) => j.id === id);
      if (!job) throw new Error(`Unknown job ${id}`);
      const orphaned = !state.jobs.some((j) => j.id !== id && j.companyId === job.companyId);
      const deleted: DeletedJob = {
        job,
        company: orphaned ? (state.companies.find((c) => c.id === job.companyId) ?? null) : null,
        applications: state.applications.filter((a) => a.jobId === id),
        events: state.events.filter((e) => e.jobId === id),
      };
      commit({
        ...state,
        companies: orphaned ? state.companies.filter((c) => c.id !== job.companyId) : state.companies,
        jobs: state.jobs.filter((j) => j.id !== id),
        applications: state.applications.filter((a) => a.jobId !== id),
        events: state.events.filter((e) => e.jobId !== id),
      });
      return deleted;
    },

    async restoreJob({ job, company, applications, events }) {
      commit({
        ...state,
        companies: company ? [...state.companies, company] : state.companies,
        jobs: [...state.jobs, job],
        applications: [...state.applications, ...applications],
        events: [...state.events, ...events],
      });
    },

    async saveAccount({ id, ...fields }) {
      if (id) {
        commit({ ...state, accounts: state.accounts.map((a) => (a.id === id ? { ...a, ...fields } : a)) });
        return id;
      }
      const account = { id: newId('acc'), ...fields, createdAt: now() };
      commit({ ...state, accounts: [...state.accounts, account] });
      return account.id;
    },

    async deleteAccount(id) {
      if (state.applications.some((a) => a.accountId === id)) throw new Error('Account is in use');
      commit({ ...state, accounts: state.accounts.filter((a) => a.id !== id) });
    },

    async saveResume({ id, name }) {
      if (id) {
        commit({ ...state, resumes: state.resumes.map((r) => (r.id === id ? { ...r, name } : r)) });
        return id;
      }
      const resume = { id: newId('res'), name, createdAt: now() };
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
        commit({
          ...state,
          channels: state.channels.map((c) => (c.id === id && !c.builtin ? { ...c, name } : c)),
        });
        return id;
      }
      const channel = { id: newId('ch'), name, builtin: false };
      commit({ ...state, channels: [...state.channels, channel] });
      return channel.id;
    },

    async deleteChannel(id) {
      commit({
        ...state,
        channels: state.channels.filter((c) => c.id !== id || c.builtin),
        applications: state.applications.map((a) => (a.channelId === id ? { ...a, channelId: null } : a)),
      });
    },

    async resetSampleData() {
      commit(createSampleData(new Date()));
    },
  };
}
