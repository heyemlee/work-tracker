import { expect } from '@playwright/test';
import { fixture, seed, serve, test } from './harness';

const POSTING = 'https://job-boards.greenhouse.io/discord/jobs/8811574002';
const THANKS = '<!doctype html><title>Discord</title><main><h1>Thank you for applying.</h1></main>';

type Extension = { chrome: { runtime: { reload(): void } } };

test('takes its card away from a page left open while the extension is reloaded', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'job-boards.greenhouse.io', fixture('greenhouse/discord.html'), THANKS);
  const page = await context.newPage();
  await page.goto(POSTING);
  const card = page.locator('outbox-autofill');
  await expect(card.getByRole('button', { name: /^Fill/ })).toBeVisible();

  // The page keeps the old content script, which can no longer reach the extension: a card left there would have
  // buttons that do nothing. (Chromium doesn't bring an extension loaded from the command line back, so the new
  // copy coming in with the toolbar button isn't covered here.)
  await worker
    .evaluate(() => (globalThis as unknown as Extension).chrome.runtime.reload())
    .catch(() => undefined);
  await expect(card).toHaveCount(0, { timeout: 10_000 });
});
