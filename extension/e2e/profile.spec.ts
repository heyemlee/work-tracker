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

test('picks what has a list to pick from: the status, a job still held, the languages', async ({
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
  const save = async () => {
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet.getByText('Saved', { exact: true })).toBeVisible();
  };

  // A status says whether it's OPT: picking one sets both.
  await sheet.getByRole('tab', { name: 'Work authorization' }).click();
  const opt = sheet.locator('label.field', { has: page.getByText('OPT', { exact: true }) }).locator('select');
  await sheet.getByLabel('Current status').selectOption('F-1 OPT');
  await expect(opt).toHaveValue('opt');
  await sheet.getByLabel('Current status').selectOption('H-1B');
  await expect(opt).toHaveValue('none');
  await sheet.getByLabel('Current status').selectOption('F-1 STEM OPT');
  await expect(opt).toHaveValue('stem');

  // The job still held says "Present" where its end date would be; a date takes its place, and gives it back.
  await sheet.getByRole('tab', { name: 'Work experience' }).click();
  const present = sheet.getByRole('checkbox', { name: 'Present' }).first();
  await expect(present).toBeChecked();
  await sheet.getByRole('button', { name: 'End' }).first().click();
  await expect(present).not.toBeChecked();
  await sheet.getByLabel('End').first().fill('2026-03');

  // Languages are ticked on a list that folds behind what's chosen, and kept in the list's order.
  await sheet.getByRole('tab', { name: 'Skills' }).click();
  const languages = sheet.getByRole('button', { name: 'Languages' });
  await expect(languages).toHaveText('English, Mandarin');
  await languages.click();
  await sheet.getByRole('option', { name: 'Korean' }).click();
  await sheet.getByRole('option', { name: 'Cantonese' }).click();
  await sheet.getByRole('option', { name: 'Mandarin' }).click();
  await expect(languages).toHaveText('English, Cantonese, Korean');
  // Escape closes the list, not the window.
  await languages.press('Escape');
  await expect(sheet.getByRole('listbox')).toHaveCount(0);

  await save();
  expect(outbox.profiles.at(-1)).toMatchObject({
    workAuthorization: { status: 'F-1 STEM OPT', opt: 'stem' },
    experience: [{ company: 'Acme AI', end: '2026-03' }, {}, {}],
    languages: ['English', 'Cantonese', 'Korean'],
  });

  await sheet.getByRole('tab', { name: 'Work experience' }).click();
  await present.click();
  await expect(sheet.getByRole('button', { name: 'End' }).first()).toHaveText('Present');
  await save();
  expect(outbox.profiles.at(-1)).toMatchObject({ experience: [{ company: 'Acme AI', end: null }, {}, {}] });
});
