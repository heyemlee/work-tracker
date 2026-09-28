import type { SavedProfile } from '../domain/profile';
import type { QuickAddResult, Repository } from '../domain/repository';
import { bytesToBase64 } from '../domain/resumes';
import type { Id, ResumeFile, Snapshot, TimelineEvent } from '../domain/types';

export class UnauthorizedError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'UnauthorizedError';
  }
}

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new HttpError(response.status, (await response.text()) || response.statusText);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

const at = (id: Id) => encodeURIComponent(id);

/** Where a resume's PDF opens in the browser's own viewer. */
export const resumeFileUrl = (id: Id) => `/api/resumes/${at(id)}/file`;

/** The Repository contract over the Worker's REST API. */
export function createHttpRepository(): Repository {
  const create = async (path: string, body: unknown) => (await request<{ id: Id }>('POST', path, body)).id;

  return {
    load: () => request<Snapshot>('GET', '/snapshot'),
    loadEvents: (jobId) => request<TimelineEvent[]>('GET', `/jobs/${at(jobId)}/events`),

    quickAdd: (input) => request<QuickAddResult>('POST', '/quick-add', input),
    undoQuickAdd: (result) => request<void>('POST', '/quick-add/undo', result),

    addApplication: (input) => create('/applications', input),
    removeApplication: (id) => request<void>('DELETE', `/applications/${at(id)}`),
    setStage: (id, stage) => request<void>('PATCH', `/applications/${at(id)}`, { stage }),
    setRejected: (id, rejected) => request<void>('PATCH', `/applications/${at(id)}`, { rejected }),
    updateApplication: (id, patch) => request<void>('PATCH', `/applications/${at(id)}`, patch),

    updateJob: (id, patch) => request<void>('PATCH', `/jobs/${at(id)}`, patch),
    deleteJob: (id) => request<void>('DELETE', `/jobs/${at(id)}`),
    restoreJob: (id) => request<void>('POST', `/jobs/${at(id)}/restore`),

    saveAccount: async ({ id, ...fields }) => {
      if (!id) return create('/accounts', fields);
      await request<void>('PATCH', `/accounts/${at(id)}`, fields);
      return id;
    },
    deleteAccount: (id) => request<void>('DELETE', `/accounts/${at(id)}`),

    saveResume: async ({ id, name }) => {
      if (!id) return create('/resumes', { name });
      await request<void>('PATCH', `/resumes/${at(id)}`, { name });
      return id;
    },
    deleteResume: (id) => request<void>('DELETE', `/resumes/${at(id)}`),
    saveResumeFile: (id, file) => request<ResumeFile>('PUT', `/resumes/${at(id)}/file`, file),
    loadResumeFile: async (id) => {
      const response = await fetch(resumeFileUrl(id), { credentials: 'same-origin' });
      if (response.status === 401) throw new UnauthorizedError();
      if (response.status === 404) return null;
      if (!response.ok) throw new HttpError(response.status, response.statusText);
      const name = /filename\*=UTF-8''([^;]+)/.exec(response.headers.get('Content-Disposition') ?? '')?.[1];
      return {
        name: name ? decodeURIComponent(name) : 'resume.pdf',
        data: bytesToBase64(new Uint8Array(await response.arrayBuffer())),
      };
    },

    saveChannel: async ({ id, name }) => {
      if (!id) return create('/channels', { name });
      await request<void>('PATCH', `/channels/${at(id)}`, { name });
      return id;
    },
    deleteChannel: (id) => request<void>('DELETE', `/channels/${at(id)}`),

    loadProfile: async () => (await request<{ saved: SavedProfile | null }>('GET', '/profile')).saved,
    saveProfile: (profile) => request<SavedProfile>('PUT', '/profile', profile),
  };
}
