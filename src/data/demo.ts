import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useI18n } from '../i18n/context';
import { showToast } from '../state/toasts';

export type DemoStart = 'started' | 'tooMany' | 'busy' | 'failed';

/** Why a sandbox couldn't be started, in words. */
export const DEMO_FAILURE_MESSAGES = {
  tooMany: 'demo.tooMany',
  busy: 'demo.busy',
  failed: 'demo.failed',
} as const;

let starting: Promise<DemoStart> | null = null;

/**
 * Starts a sandbox for this visitor; the Worker answers with the cookie that identifies it. Calls made while one
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

/**
 * Starts over with a fresh sandbox. It counts toward the same limits as a first visit, so resetting can't be used
 * to write without bound; the old sandbox is purged with the rest after a day.
 */
export function useResetDemo() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useCallback(async () => {
    const outcome = await startDemo();
    if (outcome === 'started') await queryClient.invalidateQueries();
    else showToast({ message: t(DEMO_FAILURE_MESSAGES[outcome]) });
  }, [queryClient, t]);
}
