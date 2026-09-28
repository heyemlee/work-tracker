import { expect } from '@playwright/test';
import { fixture, seed, serve, test } from './harness';

const URL = 'https://job-boards.greenhouse.io/discord/jobs/8811574002';
const THANKS =
  '<!doctype html><title>Discord</title><main><h1>Thank you for applying.</h1><p>Your application has been submitted.</p></main>';

test('fills a Greenhouse application and logs it to Outbox after the owner submits', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  // E2E_DEBUG=1 prints the service worker's and the page's console.
  if (process.env.E2E_DEBUG) {
    worker.on('console', (message) => console.log('[sw]', message.text()));
    context.on('page', (page) => page.on('console', (message) => console.log('[page]', message.text())));
  }
  await serve(context, 'job-boards.greenhouse.io', fixture('greenhouse/discord.html'), THANKS);
  const page = await context.newPage();
  await page.goto(URL);

  const card = page.locator('outbox-autofill');
  await expect(card.getByText('Senior Full-Stack Software Engineer, Developer Success')).toBeVisible();
  await expect(card.getByRole('button', { name: /alex@example\.com/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(page.locator('#first_name')).toHaveValue('Alex');
  await expect(page.locator('#last_name')).toHaveValue('Chen');
  await expect(page.locator('#email')).toHaveValue('alex@example.com');
  await expect(page.locator('#phone')).toHaveValue('+1 408-555-0100');
  await expect(page.getByLabel('LinkedIn Profile')).toHaveValue('https://www.linkedin.com/in/alex-chen');
  await expect(page.getByLabel('How did you hear about this job?')).toHaveValue('LinkedIn');
  expect(await page.locator('#resume').evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe(
    'Alex_Chen_Resume.pdf',
  );
  // The saved page runs no React, so its dropdowns never open: they land in "Fill these yourself".
  await expect(card.getByText(/^Filled · \d+/)).toBeVisible({ timeout: 45_000 });
  await expect(card.getByText(/^Fill these yourself · \d+/)).toBeVisible();
  await page.screenshot({ path: 'e2e/output/greenhouse-filled.png' });
  await page.locator('outbox-autofill .card').screenshot({ path: 'e2e/output/card.png' });

  // The owner presses Submit. The saved page has no React behind it, so its react-select stand-ins stay required.
  await page.evaluate(() =>
    document.querySelectorAll('[required]').forEach((element) => element.removeAttribute('required')),
  );
  await page.locator('.application--submit button[type="submit"]').click();
  await expect.poll(() => outbox.quickAdds.length, { timeout: 15_000 }).toBe(1);
  expect(outbox.quickAdds[0]).toMatchObject({
    companyName: 'Discord',
    title: 'Senior Full-Stack Software Engineer, Developer Success',
    url: URL,
    accountIds: ['acc-1'],
    channelId: 'ch_company_site',
    resumeId: 'res-1',
  });
  await expect(page.locator('outbox-autofill').getByText('Logged to Outbox')).toBeVisible();
  await page.screenshot({ path: 'e2e/output/greenhouse-logged.png' });
});
