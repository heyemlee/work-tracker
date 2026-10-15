import { resumeFactsSchema, type ResumeFacts } from '../domain/profile';

export class LocalToolsError extends Error {
  readonly unavailable: boolean;
  constructor(message: string, unavailable = false) {
    super(message);
    this.unavailable = unavailable;
  }
}

/** This build has a dev-only same-origin bridge. Production must never reach a visitor's localhost. */
export const localToolsAvailable = import.meta.env.DEV;

export async function localToolRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!localToolsAvailable) throw new LocalToolsError('NOT_HOSTED', true);
  const form = body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`/local-tools${path}`, {
      method,
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        'x-outbox-local': '1',
        ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
  } catch {
    throw new LocalToolsError('SERVICE_UNAVAILABLE', true);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
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
