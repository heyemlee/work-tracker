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
  // One account on Outbox: the card names it rather than offering a choice.
  await expect(card.getByText('alex@example.com')).toBeVisible();

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
  // The saved page runs no React, so its dropdowns never open: they're listed for the owner to fill.
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });
  await expect(card.getByText('Fill', { exact: true }).first()).toBeVisible();
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

// Greenhouse asks for race only once "Are you Hispanic/Latino?" is answered. This stand-in adds the question when
// the first one changes.
const FOLLOW_UP_FORM = `<!doctype html><html><head><title>Job Application for Software Engineer at Acme</title></head><body>
<form id="application-form">
  <label for="first_name">First Name</label><input id="first_name" type="text">
  <label for="last_name">Last Name</label><input id="last_name" type="text">
  <label for="email">Email</label><input id="email" type="text">
  <div id="eeo">
    <label for="hispanic_ethnicity">Are you Hispanic/Latino?</label>
    <select id="hispanic_ethnicity"><option value="">Select...</option><option>Yes</option><option>No</option><option>Decline To Self Identify</option></select>
  </div>
</form>
<script>
  document.querySelector('#hispanic_ethnicity').addEventListener('change', () => {
    if (document.querySelector('#race')) return;
    document.querySelector('#eeo').insertAdjacentHTML('beforeend',
      '<label for="race">Please identify your race</label><select id="race"><option value="">Select...</option><option>Asian</option><option>White</option><option>Decline To Self Identify</option></select>');
  });
</script></body></html>`;

test('fills a question that appears once another is answered', async ({ context, worker, outbox }) => {
  await seed(worker, outbox.url);
  await serve(context, 'job-boards.greenhouse.io', FOLLOW_UP_FORM, THANKS);
  const page = await context.newPage();
  await page.goto('https://job-boards.greenhouse.io/acme/jobs/123');

  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });
  // The test applicant left voluntary self-identification at "decline".
  await expect(page.locator('#hispanic_ethnicity')).toHaveValue('Decline To Self Identify');
  await expect(page.locator('#race')).toHaveValue('Decline To Self Identify');
});
