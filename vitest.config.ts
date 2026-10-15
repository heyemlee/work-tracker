import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so unit tests run in plain Node without starting workerd.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Calendar-date logic is local-time; pin the owner's zone so tests don't depend on the machine.
    env: { TZ: 'America/Los_Angeles' },
  },
});
