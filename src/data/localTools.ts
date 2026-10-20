import { resumeFactsSchema, type ResumeFacts } from '../domain/profile';

export class LocalToolsError extends Error {
  readonly unavailable: boolean;
  constructor(message: string, unavailable = false) {
    super(message);
    this.unavailable = unavailable;
  }
}

/**
 * In development, Vite's same-origin bridge to the service on this machine (scripts/localToolsProxy.ts). Deployed, the
 * Worker's /api/tools, which checks the session and reaches the owner's computer through a tunnel (worker/tools.ts).
 * Neither ever calls a visitor's localhost.
 */
const dev = import.meta.env.DEV;

export async function localToolRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const form = body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${dev ? '/local-tools' : '/api/tools'}${path}`, {
      method,
      // The bridge has no use for the site's cookies; the Worker needs the session's.
      credentials: dev ? 'omit' : 'same-origin',
      cache: 'no-store',
      headers: {
        ...(dev ? { 'x-outbox-local': '1' } : {}),
        ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
  } catch {
    throw new LocalToolsError('SERVICE_UNAVAILABLE', true);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    // A deployment with no service connected says so, and there's nothing to retry.
    if (data?.code === 'NOT_HOSTED') throw new LocalToolsError('NOT_HOSTED', true);
    const unavailable = !data || ['SERVICE_UNAVAILABLE', 'LOCAL_ONLY', 'NOT_FOUND'].includes(data.code);
    throw new LocalToolsError(
      typeof data?.message === 'string' ? data.message : 'REQUEST_FAILED',
      unavailable,
    );
  }
  return data as T;
}

export type Provider = 'openai' | 'anthropic';
export type ParseMethod = 'function-calling' | 'structured-output';
export interface ModelChoice {
  provider: Provider;
  model: string;
  label: string;
  selectable?: boolean;
  canParse?: boolean;
}
export interface ModelStatus {
  enabled: boolean;
  provider: Provider;
  model: string | null;
  hasKey: boolean;
  configuredProviders: Record<Provider, boolean>;
  openaiBaseUrl: string;
  models: ModelChoice[];
  modelPolicy: { canParse: boolean; reason: string };
  budgetLimitUsd: number;
}
export interface ExtractedResume {
  text: string;
  warnings: string[];
  pages?: number;
}
export interface ParsedResume {
  facts: ResumeFacts;
  model: string;
  method: ParseMethod;
  elapsedMs?: number;
}

export async function parseLocalResume(text: string, method: ParseMethod): Promise<ParsedResume> {
  const result = await localToolRequest<ParsedResume>('/api/resumes/parse', 'POST', { text, method });
  const parsed = resumeFactsSchema.safeParse(result.facts);
  if (!parsed.success) throw new LocalToolsError('INVALID_RESULT');
  return { ...result, facts: parsed.data };
}

export interface DiscoveredJob {
  id: string;
  title: string;
  company: string;
  location: string;
  department: string;
  url: string;
  remote: boolean;
  active: boolean;
  provider?: string;
  description?: string;
}
export interface Board {
  id: string;
  company: string;
  provider: string;
  enabled: boolean;
  activeJobs: number;
  syncedAt: string | null;
  lastError: string | null;
}
export interface SyncStatus {
  running: boolean;
  total: number;
  completed: number;
  finishedAt: string | null;
  error: string | null;
  results: { company: string; error?: string }[];
}
