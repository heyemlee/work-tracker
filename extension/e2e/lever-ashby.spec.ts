import { expect } from '@playwright/test';
import { fixture, seed, serve, test } from './harness';

const THANKS =
  '<!doctype html><title>Thanks</title><div class="content"><h3>Application submitted!</h3><p>Thanks for applying.</p></div>';

test('fills a Lever application, and logs it once the thank-you page loads', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'jobs.lever.co', fixture('lever/palantir.html'), THANKS);
  const page = await context.newPage();
  const apply = 'https://jobs.lever.co/palantir/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2/apply';
  await page.goto(apply);

  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(card.getByText(/^Filled · \d+/)).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('input[name="name"]')).toHaveValue('Alex Chen');
  await expect(page.locator('input[name="email"]')).toHaveValue('alex@example.com');
  await expect(page.locator('input[name="org"]')).toHaveValue('Acme AI');
  await expect(page.locator('input[name="urls[GitHub]"]')).toHaveValue('https://github.com/alexchen');
  // Work authorization, by rule, for this posting's country: it's in London, where an F-1 student isn't authorized
  // and would need sponsorship.
  const authorized = page.locator(
    'input[type="radio"][name="cards[1c719ca9-5069-4afe-9e82-39ca420e0edb][field0]"][value="No"]',
  );
  const sponsorship = page.locator(
    'input[type="radio"][name="cards[1c719ca9-5069-4afe-9e82-39ca420e0edb][field1]"][value="Yes"]',
  );
  await expect(authorized).toBeChecked();
  await expect(sponsorship).toBeChecked();
  await expect(card.getByText(/^Check these · \d+/)).toBeVisible();
  expect(
    await page.locator('#resume-upload-input').evaluate((input: HTMLInputElement) => input.files?.length),
  ).toBe(1);

  // Lever submits with a script; the owner's click is the attempt, the thank-you page the confirmation.
  await page.locator('#btn-submit').click();
  await page.goto('https://jobs.lever.co/palantir/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2/thanks');
  await expect.poll(() => outbox.quickAdds.length, { timeout: 15_000 }).toBe(1);
  expect(outbox.quickAdds[0]).toMatchObject({
    companyName: 'Palantir Technologies',
    url: 'https://jobs.lever.co/palantir/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2',
    accountIds: ['acc-1'],
  });
});

test('keeps what Lever read from the resume and what the owner typed, and fills the rest', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  // Lever reads an uploaded resume and fills the fields it found; this stands in for its parser.
  const parser = `<script>
    document.querySelector('#resume-upload-input').addEventListener('change', () => setTimeout(() => {
      for (const [name, value] of [['name', 'Alexander Chen'], ['email', 'alex.chen@gmail.com'], ['org', 'Acme AI Labs']]) {
        const input = document.querySelector('input[name="' + name + '"]');
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 200));
  </script>`;
  await serve(
    context,
    'jobs.lever.co',
    fixture('lever/palantir.html').replace('</body>', `${parser}</body>`),
    THANKS,
  );
  const page = await context.newPage();
  await page.goto('https://jobs.lever.co/palantir/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2/apply');
  await page.locator('input[name="phone"]').fill('+1 408 555 0100');

  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(card.getByText(/^Filled · \d+/)).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('input[name="name"]')).toHaveValue('Alexander Chen');
  await expect(page.locator('input[name="org"]')).toHaveValue('Acme AI Labs');
  await expect(page.locator('input[name="phone"]')).toHaveValue('+1 408 555 0100');
  // The email is the account applying, not the resume's.
  await expect(page.locator('input[name="email"]')).toHaveValue('alex@example.com');
  await expect(page.locator('input[name="urls[GitHub]"]')).toHaveValue('https://github.com/alexchen');
});

test('fills an Ashby application: system fields, yes/no buttons, radio groups', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'jobs.ashbyhq.com', fixture('ashby/notion.html'), THANKS);
  const page = await context.newPage();
  await page.goto('https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a/application');

  const card = page.locator('outbox-autofill');
  await expect(card.getByText('Software Engineer, Developer Platform')).toBeVisible();
  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(card.getByText(/^Filled · \d+/)).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('#_systemfield_name')).toHaveValue('Alex Chen');
  await expect(page.locator('#_systemfield_email')).toHaveValue('alex@example.com');
  await expect(page.getByLabel('LinkedIn Profile')).toHaveValue('https://www.linkedin.com/in/alex-chen');
  await expect(page.getByLabel('Decline to self-identify').first()).toBeChecked();
  await expect(page.getByLabel('LinkedIn', { exact: true })).toBeChecked();
  await page.locator('outbox-autofill .card').screenshot({ path: 'e2e/output/ashby-card.png' });
});
