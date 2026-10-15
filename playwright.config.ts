import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5181', viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: 'PORT=5181 VITE_DATA=local npm run dev',
    url: 'http://127.0.0.1:5181',
    reuseExistingServer: false,
  },
});
