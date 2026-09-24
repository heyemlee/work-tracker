import { BUILTIN_CHANNELS } from '../domain/channels';
import { describeRepositoryContract } from '../domain/repository.contract';
import { createLocalRepository } from './localRepository';

describeRepositoryContract('local', async (clock) =>
  createLocalRepository({
    storage: null,
    clock,
    initial: () => ({
      accounts: [],
      resumes: [],
      channels: [...BUILTIN_CHANNELS],
      companies: [],
      jobs: [],
      applications: [],
      events: [],
    }),
  }),
);
