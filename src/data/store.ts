import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { createLocalRepository } from './localRepository';
import type { Repository } from './repository';

export const repository: Repository = createLocalRepository();

const SNAPSHOT_KEY = ['snapshot'] as const;

export function useSnapshot() {
  return useQuery({ queryKey: SNAPSHOT_KEY, queryFn: () => repository.load(), staleTime: Infinity });
}

/** Runs a repository operation, then refreshes the snapshot every view reads from. */
export function useRepository() {
  const queryClient = useQueryClient();
  return useCallback(
    async <T>(operation: (repo: Repository) => Promise<T>): Promise<T> => {
      const result = await operation(repository);
      await queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      return result;
    },
    [queryClient],
  );
}
