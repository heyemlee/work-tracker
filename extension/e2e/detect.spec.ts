import { expect } from '@playwright/test';
import { seed, serve, test } from './harness';

const THANKS = '<!doctype html><title>Thanks</title><main><h1>Thank you for applying.</h1></main>';

const FIELDS =
  '<label for="first">First name</label><input id="first" name="first_name" required>' +
  '<label for="last">Last name</label><input id="last" name="last_name" required>' +
  '<label for="email">Email</label><input id="email" name="email" type="email" required>' +
  '<label for="resume">Resume/CV</label><input id="resume" name="resume" type="file">' +
  '<button type="submit">Submit application</button>';

/** A career site the extension has no adapter for. */
const CAREERS = 'careers.acme-robotics.com';
const POSTING = `https://${CAREERS}/jobs/42`;

test('opens the card by itself on an application form on a site it has no adapter for', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(
    context,
    CAREERS,
    `<!doctype html><title>Robotics Engineer</title><main><h1>Robotics Engineer</h1><form>${FIELDS}</form></main>`,
    THANKS,
  );
  const page = await context.newPage();
  await page.goto(`${POSTING}/apply`);

  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: /^Fill/ }).click({ timeout: 15_000 });
  await expect(page.locator('#first')).toHaveValue('Alex');
  await expect(page.locator('#email')).toHaveValue('alex@example.com');
  await expect(page.locator('outbox-autofill')).toHaveCount(1);
});

test('opens the card when a career site shows its form in place', async ({ context, worker, outbox }) => {
  await seed(worker, outbox.url);
  const script = `document.querySelector('#apply').addEventListener('click', () =>
    document.querySelector('main').insertAdjacentHTML('beforeend', ${JSON.stringify(`<form>${FIELDS}</form>`)}));`;
  await serve(
    context,
    CAREERS,
    `<!doctype html><title>Robotics Engineer</title><main><h1>Robotics Engineer</h1><button id="apply">Apply</button></main><script>${script}</script>`,
    THANKS,
  );
  const page = await context.newPage();
  await page.goto(POSTING);
  await page.waitForTimeout(1500);
  await expect(page.locator('outbox-autofill')).toHaveCount(0);

  await page.locator('#apply').click();
  await expect(page.locator('outbox-autofill').getByRole('button', { name: /^Fill/ })).toBeVisible({
    timeout: 15_000,
  });
});

test('has the card’s Fill ready once Workday draws its fields, well after the page loads', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  const fields =
    '<div data-automation-id="formField-legalNameSection_firstName"><label for="first">First Name*</label>' +
    '<input id="first" data-automation-id="legalNameSection_firstName"></div>' +
    '<div data-automation-id="formField-legalNameSection_lastName"><label for="last">Last Name*</label>' +
    '<input id="last" data-automation-id="legalNameSection_lastName"></div>';
  const script = `setTimeout(() => document.querySelector('[data-automation-id="applyFlowPage"]')
    .insertAdjacentHTML('beforeend', ${JSON.stringify(fields)}), 2500);`;
  await serve(
    context,
    'acme.wd5.myworkdayjobs.com',
    `<!doctype html><title>Software Engineer</title><div data-automation-id="applyFlowPage">` +
      `<div data-automation-id="progressBarActiveStep">My Information</div></div><script>${script}</script>`,
    THANKS,
  );
  const page = await context.newPage();
  await page.goto(
    'https://acme.wd5.myworkdayjobs.com/en-US/External/job/San-Jose-CA/Software-Engineer_R123/apply',
  );

  // No clicking the pill. The page is an application's by its address, so the card is up before the fields are,
  // its button waiting; and Fill is ready once they're there.
  const fill = page.locator('outbox-autofill').getByRole('button', { name: /^Fill/ });
  await expect(fill).toBeDisabled({ timeout: 15_000 });
  await expect(fill).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator('outbox-autofill')).toHaveCount(1);
});

test('leaves a contact form with an attachment alone', async ({ context, worker, outbox }) => {
  await seed(worker, outbox.url);
  await serve(
    context,
    'www.acme-robotics.com',
    '<!doctype html><title>Contact</title><form>' +
      '<label for="name">Name</label><input id="name">' +
      '<label for="email">Email</label><input id="email" type="email">' +
      '<label for="message">Message</label><textarea id="message"></textarea>' +
      '<label for="file">Attachment</label><input id="file" type="file">' +
      '</form>',
    THANKS,
  );
  const page = await context.newPage();
  await page.goto('https://www.acme-robotics.com/contact');
  await page.waitForTimeout(2000);
  await expect(page.locator('outbox-autofill')).toHaveCount(0);
});
