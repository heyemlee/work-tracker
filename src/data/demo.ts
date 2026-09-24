import { request } from './httpRepository';

export type DemoStart = 'started' | 'tooMany' | 'busy' | 'failed';

let starting: Promise<DemoStart> | null = null;

/**
 * Creates this visitor's sandbox; the Worker answers with the cookie that identifies it. Calls made while one
 * is in flight share it, so running the effect twice (StrictMode does) never creates two sandboxes.
 */
export function startDemo(): Promise<DemoStart> {
  starting ??= fetch('/api/demo/session', { method: 'POST', credentials: 'same-origin' })
    .then((response): DemoStart => {
      if (response.ok) return 'started';
      if (response.status === 429) return 'tooMany';
      if (response.status === 503) return 'busy';
      return 'failed';
    })
    .catch((): DemoStart => 'failed')
    .finally(() => {
      starting = null;
    });
  return starting;
}

/** Puts the visitor's sandbox back to fresh sample data. */
export const resetDemo = () => request<void>('POST', '/demo/reset');
