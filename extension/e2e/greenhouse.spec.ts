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
  await expect(card.getByTitle(/^Fill: /).first()).toBeVisible();
  // The page went along with the fill, down from the top of the posting.
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
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

// Greenhouse's city and school fields search as you type and take only a pick. This stand-in draws them as its
// react-select does: no list until a key comes up on typed text (the form opens it on keyup; text that only
// changes opens nothing), suggestions a moment later, the pick shown beside an input that empties. The phone
// widget's country list sits above them, hidden by its stylesheet.
const SEARCH_FORM = `<!doctype html><html><head><title>Job Application for Software Engineer at Acme</title>
<style>.iti__hide { display: none; }</style></head><body>
<form id="application-form">
  <label for="first_name">First Name</label><input id="first_name" type="text">
  <label for="last_name">Last Name</label><input id="last_name" type="text">
  <label for="email">Email</label><input id="email" type="text">
  <div class="iti__dropdown-content iti__hide"><ul role="listbox">
    <li role="option">Afghanistan +93</li><li role="option">United States +1</li></ul></div>
  <div class="select-shell" data-list="cities"><label id="candidate-location-label" for="candidate-location">Location (City)</label>
    <div><div class="select__control"><div class="select__input-container">
      <input id="candidate-location" type="text" role="combobox" aria-labelledby="candidate-location-label"></div></div></div></div>
  <div class="select-shell" data-list="schools"><label id="school--0-label" for="school--0">School</label>
    <div><div class="select__control"><div class="select__input-container">
      <input id="school--0" type="text" role="combobox" aria-labelledby="school--0-label"></div></div></div></div>
</form>
<script>
  const LISTS = {
    cities: ['Santa Clara, Villa Clara, Cuba', 'Santa Clara, California, United States', 'Santa Clara, Utah, United States'],
    schools: ['Aalborg University', 'Aalto University', 'Santa Clara University'],
  };
  for (const shell of document.querySelectorAll('.select-shell')) {
    const input = shell.querySelector('input');
    const show = (texts) => {
      shell.querySelector('.select__menu')?.remove();
      const menu = document.createElement('div');
      menu.className = 'select__menu';
      menu.innerHTML = '<div role="listbox">' + texts.map((text) => '<div class="select__option" role="option">' + text + '</div>').join('') + '</div>';
      menu.addEventListener('click', (event) => {
        shell.querySelector('.select__single-value')?.remove();
        shell.querySelector('.select__input-container').insertAdjacentHTML('beforebegin', '<div class="select__single-value">' + event.target.textContent + '</div>');
        input.value = '';
        menu.remove();
      });
      shell.append(menu);
    };
    input.addEventListener('keyup', () => {
      shell.querySelector('.select__menu')?.remove();
      if (!input.value) return;
      const all = LISTS[shell.dataset.list];
      // The school list shows its first page while the search runs.
      if (shell.dataset.list === 'schools') show(all.slice(0, 2));
      setTimeout(() => show(all.filter((text) => text.toLowerCase().includes(input.value.toLowerCase()))), 400);
    });
  }
</script></body></html>`;

test('searches for the city and the school, and picks the applicant’s', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'job-boards.greenhouse.io', SEARCH_FORM, THANKS);
  const page = await context.newPage();
  await page.goto('https://job-boards.greenhouse.io/acme/jobs/123');

  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });
  // The test applicant lives in Santa Clara, CA: not the Cuban city listed first, nor the hidden country list.
  await expect(page.locator('[data-list="cities"] .select__single-value')).toHaveText(
    'Santa Clara, California, United States',
  );
  await expect(page.locator('[data-list="schools"] .select__single-value')).toHaveText(
    'Santa Clara University',
  );
});

// After a fill the owner goes on by hand. This stand-in asks one thing the rules have no answer for.
const BY_HAND_FORM = `<!doctype html><html><head><title>Job Application for Software Engineer at Acme</title></head><body>
<form id="application-form">
  <label for="first_name">First Name</label><input id="first_name" type="text" required>
  <label for="last_name">Last Name</label><input id="last_name" type="text" required>
  <label for="email">Email</label><input id="email" type="text" required>
  <label for="office">What is your preferred office location?</label>
  <select id="office" required><option value="">Select...</option><option>Menlo Park, CA</option><option>New York, NY</option></select>
</form></body></html>`;

test('follows what the owner fills in and empties by hand after the fill', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'job-boards.greenhouse.io', BY_HAND_FORM, THANKS);
  const page = await context.newPage();
  await page.goto('https://job-boards.greenhouse.io/acme/jobs/123');

  const card = page.locator('outbox-autofill');
  const line = (label: string) => card.locator('.item', { hasText: label });
  await card.getByRole('button', { name: /^Fill/ }).click();
  // The office is the owner's to pick.
  await expect(card.getByText('Filled 3/4 required')).toBeVisible({ timeout: 45_000 });
  await expect(card.getByTitle('Fill: What is your preferred office location?')).toBeVisible();

  await page.selectOption('#office', 'Menlo Park, CA');
  await expect(card.getByText('Filled 4/4 required')).toBeVisible();
  await expect(line('preferred office location').locator('.mark.on')).toBeVisible();
  await expect(line('preferred office location')).toContainText('Menlo Park, CA');

  // A field the fill had filled, emptied: the owner's to fill again. And the office, changed, shows the new pick.
  await page.locator('#first_name').fill('');
  await page.selectOption('#office', 'New York, NY');
  await expect(card.getByText('Filled 3/4 required')).toBeVisible();
  await expect(card.getByTitle('Fill: First Name')).toBeVisible();
  await expect(line('preferred office location')).toContainText('New York, NY');
});

test('filling again keeps an answer the owner corrected, and fills what they emptied', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'job-boards.greenhouse.io', BY_HAND_FORM, THANKS);
  const page = await context.newPage();
  await page.goto('https://job-boards.greenhouse.io/acme/jobs/123');

  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(card.getByText('Filled 3/4 required')).toBeVisible({ timeout: 45_000 });

  await page.locator('#last_name').fill('Chan');
  await page.locator('#first_name').fill('');
  await page.selectOption('#office', 'New York, NY');
  await expect(card.getByText('Filled 3/4 required')).toBeVisible();
  await card.getByRole('button', { name: 'Fill again' }).click();

  await expect(page.locator('#first_name')).toHaveValue('Alex');
  await expect(card.getByText('Filled 4/4 required')).toBeVisible();
  await expect(page.locator('#last_name')).toHaveValue('Chan');
  await expect(page.locator('#office')).toHaveValue('New York, NY');
  await expect(card.locator('.item', { hasText: 'Last Name' })).toContainText('Chan');
});
