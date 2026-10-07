import { expect } from '@playwright/test';
import { seed, serve, test } from './harness';

const THANKS = '<!doctype html><title>Thanks</title><main><h1>Thank you for applying.</h1></main>';
const FORM =
  '<!doctype html><title>Robotics Engineer</title><main><h1>Robotics Engineer</h1><form>' +
  '<label for="first">First name</label><input id="first" name="first_name">' +
  '<label for="phone">Phone</label><input id="phone" name="phone" type="tel">' +
  '<label for="email">Email</label><input id="email" name="email" type="email">' +
  '<label for="resume">Resume/CV</label><input id="resume" name="resume" type="file">' +
  '<button type="submit">Submit application</button></form></main>';

test('edits the profile in a window over the page, saves it to Outbox, and fills from it', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'careers.acme-robotics.com', FORM, THANKS);
  const page = await context.newPage();
  await page.goto('https://careers.acme-robotics.com/jobs/42/apply');

  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: /^Alex Chen/ }).click({ timeout: 15_000 });
  const sheet = card.getByRole('dialog', { name: 'Your autofill information' });
  const save = sheet.getByRole('button', { name: 'Save' });
  await expect(sheet.getByLabel('Legal first name')).toHaveValue('Alex');
  await expect(save).toBeDisabled();

  // A profile without a name isn't saved: the window says what's missing.
  await sheet.getByLabel('Legal first name').fill('');
  await save.click();
  await expect(sheet.getByText('Legal first name is required')).toBeVisible();
  expect(outbox.profiles).toHaveLength(0);

  await sheet.getByLabel('Legal first name').fill('Alexander');
  await sheet.getByLabel('Phone').fill('+1 408-555-0199');
  // Pronouns and the state are picked, not typed.
  await sheet.getByLabel('Pronouns').selectOption('He/him');
  await expect(sheet.getByLabel('State')).toHaveValue('CA');
  await sheet.getByRole('tab', { name: 'Skills' }).click();
  await sheet.getByRole('textbox', { name: 'Skills' }).fill('Python, Go, Rust');
  await save.click();
  await expect(sheet.getByText('Saved', { exact: true })).toBeVisible();
  expect(outbox.profiles.at(-1)).toMatchObject({
    name: { first: 'Alexander', pronouns: 'He/him' },
    phone: '+1 408-555-0199',
    skills: ['Python', 'Go', 'Rust'],
  });

  // Closed, the card names the profile as saved, and the form fills from it.
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(card.getByRole('button', { name: /^Alexander Chen/ })).toBeVisible();
  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(page.locator('#first')).toHaveValue('Alexander');
  await expect(page.locator('#phone')).toHaveValue('+1 408-555-0199');
});
