import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // PORT lets tooling assign a free port; 5180 stays clear of other Vite apps on the default 5173.
  server: { port: Number(process.env.PORT) || 5180, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Calendar-date logic is local-time; pin the owner's zone so tests don't depend on the machine.
    env: { TZ: 'America/Los_Angeles' },
  },
});
