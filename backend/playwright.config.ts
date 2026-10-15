import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/ui',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3101' },
  webServer: {
    command: 'PORT=3101 ENABLE_SYNC=false ENABLE_RESUME_AI=false node dist/src/main.js',
    url: 'http://127.0.0.1:3101/health',
    reuseExistingServer: false,
  },
});
