import { defineConfig } from '@playwright/test';

// End-to-end: the extension in Chromium, against saved application pages served on their real hosts through request
// interception, logging to a mock Outbox. Nothing is sent to a real site. The specs drive a build made as the run
// starts, whose card Playwright can look into; one spec takes the build Chrome loads (npm run build first), whose
// card it can't.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/build.ts',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
