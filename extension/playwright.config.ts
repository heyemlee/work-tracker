import { defineConfig } from '@playwright/test';

// End-to-end: the built extension (npm run build first) in Chromium, against saved application pages served on
// their real hosts through request interception, logging to a mock Outbox. Nothing is sent to a real site.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
