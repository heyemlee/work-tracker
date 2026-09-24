import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { Repository } from '../domain/repository';
import type { Application, Id, Snapshot } from '../domain/types';
import { useI18n } from '../i18n/context';
import { showToast } from '../state/toasts';
import { createHttpRepository, request, UnauthorizedError } from './httpRepository';
import { createLocalRepository } from './localRepository';

/**
 * `VITE_DATA=local` runs the whole app in the browser on sample data, with no backend — the original
 * prototype. Otherwise data lives in D1 behind the Worker.
 */
export const localRepository = import.meta.env.VITE_DATA === 'local' ? createLocalRepository() : null;
export const repository: Repository = localRepository ?? createHttpRepository();

export const ME_KEY = ['me'] as const;
const SNAPSHOT_KEY = ['snapshot'] as const;
const EVENTS_KEY = ['events'] as const;

export interface User {
  name: string;
  email: string;
  image: string | null;
  /** A visitor in the public demo's sandbox, not a signed-in owner. */
  demo: boolean;
}

/** The signed-in user. Fails with UnauthorizedError when there is no session. */
export function useCurrentUser() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => (await request<{ user: User }>('GET', '/me')).user,
    enabled: !localRepository,
    staleTime: Infinity,
    // Signing in is a full-page redirect, so there's nothing to refetch on focus — and refetching would
    // flash the sign-in screen away and back.
    refetchOnWindowFocus: false,
  });
}

export function useSnapshot(enabled = true) {
  return useQuery({ queryKey: SNAPSHOT_KEY, queryFn: () => repository.load(), enabled, staleTime: 30_000 });
}

export function useJobEvents(jobId: Id) {
  return useQuery({ queryKey: [...EVENTS_KEY, jobId], queryFn: () => repository.loadEvents(jobId) });
}

/** An optimistic update for one application, applied to the cached snapshot before the server answers. */
export function patchApplication(id: Id, patch: Partial<Application>) {
  return (snapshot: Snapshot): Snapshot => ({
    ...snapshot,
    applications: snapshot.applications.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  });
}

interface RunOptions {
  optimistic?: (snapshot: Snapshot) => Snapshot;
}

/**
 * Runs a write, then refreshes everything it may have changed. Never rejects: a failure shows a toast and
 * resolves to undefined, so callers can simply check the result.
 */
export function useRepository() {
  const queryClient = useQueryClient();
  const { t } = useI18n();

  return useCallback(
    async <T>(operation: (repo: Repository) => Promise<T>, { optimistic }: RunOptions = {}) => {
      if (optimistic) {
        await queryClient.cancelQueries({ queryKey: SNAPSHOT_KEY });
        queryClient.setQueryData<Snapshot>(SNAPSHOT_KEY, (snapshot) => snapshot && optimistic(snapshot));
      }
      try {
        return await operation(repository);
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          // Refetching the user brings back the sign-in screen, or a fresh sandbox in the demo.
          showToast({ message: t(error.demo ? 'demo.expired' : 'error.signedOut') });
          void queryClient.invalidateQueries({ queryKey: ME_KEY });
        } else {
          console.error(error);
          showToast({ message: t('error.save') });
        }
        return undefined;
      } finally {
        void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
        void queryClient.invalidateQueries({ queryKey: EVENTS_KEY });
      }
    },
    [queryClient, t],
  );
}
