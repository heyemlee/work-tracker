import { expect, type Worker } from '@playwright/test';
import { seed, serve, test } from './harness';

const THANKS =
  '<!doctype html><title>Acme</title><main><h1>Thank you for applying.</h1><p>Your application has been submitted.</p></main>';

// A form whose last question sits at the window's right edge, where the card comes up: in under it.
const UNDER_THE_CARD = `<!doctype html><html><head><title>Job Application for Software Engineer at Acme</title></head><body>
<form id="application-form">
  <label for="first_name">First Name</label><input id="first_name" type="text" required>
  <label for="last_name">Last Name</label><input id="last_name" type="text" required>
  <label for="email">Email</label><input id="email" type="text" required>
  <div style="position: fixed; top: 180px; right: 80px">
    <label for="office">What is your preferred office location?</label>
    <select id="office" required><option value="">Select...</option><option>Menlo Park, CA</option><option>New York, NY</option></select>
  </div>
</form></body></html>`;

test('goes aside at a press and gives the page back what was under it, then comes back as it was left', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'job-boards.greenhouse.io', UNDER_THE_CARD, THANKS);
  const page = await context.newPage();
  await page.goto('https://job-boards.greenhouse.io/acme/jobs/123');

  const card = page.locator('outbox-autofill');
  const pane = card.getByRole('dialog', { name: 'Outbox Autofill' });
  const tab = card.getByRole('button', { name: 'Show Outbox Autofill' });
  const minimize = card.getByRole('button', { name: 'Minimize' });
  await card.getByRole('button', { name: /^Fill/ }).click();
  // The office is the owner's to pick, and the card lies over it.
  await expect(card.getByText('Filled 3/4 required')).toBeVisible({ timeout: 45_000 });
  const office = page.locator('#office');
  const onTop = () =>
    office.evaluate((select) => {
      const box = select.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.localName;
    });
  expect(await onTop()).toBe('outbox-autofill');
  await expect(tab).toBeHidden();

  await minimize.click();
  await expect(pane).toBeHidden();
  await expect(tab).toBeVisible();
  // Nothing of the card is left over the page but its tab, clear of the question.
  expect(await onTop()).toBe('select');
  await office.click({ trial: true, timeout: 5_000 });
  await page.selectOption('#office', 'Menlo Park, CA');

  // The keyboard went to the tab with the press, and brings the card back from there: with the list it had, which
  // followed the page meanwhile.
  await expect(tab).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pane).toBeVisible();
  await expect(tab).toBeHidden();
  await expect(minimize).toBeFocused();
  await expect(card.getByText('Filled 4/4 required')).toBeVisible();
  expect(await onTop()).toBe('outbox-autofill');
});

// A board that moves from one posting to the next without loading a page, and tells a submission by its address,
// as Greenhouse does.
const BOARD = `<!doctype html><html><head><title>Jobs at Acme</title></head><body><main></main>
<script>
  const JOBS = { 123: 'Software Engineer', 456: 'Data Engineer' };
  const show = (id, sent) => {
    history.pushState(null, '', '/acme/jobs/' + id + (sent ? '/confirmation' : ''));
    document.title = 'Job Application for ' + JOBS[id] + ' at Acme';
    document.querySelector('main').innerHTML = sent
      ? '<h1>Received.</h1>'
      : '<form id="application-form"><label for="first_name">First Name</label><input id="first_name" type="text" required>' +
        '<label for="email">Email</label><input id="email" type="text" required>' +
        '<p><button type="submit">Send</button> <button type="button" id="next">See the next opening</button></p></form>';
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      show(id, true);
    });
    document.querySelector('#next')?.addEventListener('click', () => show(456, false));
  };
  show(123, false);
</script></body></html>`;

/** The toolbar button, pressed on the tab in front. */
const press = (worker: Worker) =>
  worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as {
      chrome: {
        tabs: { query(asked: object): Promise<object[]> };
        action: { onClicked: { dispatch(tab: object): void } };
      };
    };
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    chrome.action.onClicked.dispatch(tab!);
  });

test('stays aside while the page moves on, and comes back when asked for and to say an application is logged', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'job-boards.greenhouse.io', BOARD, THANKS);
  const page = await context.newPage();
  await page.goto('https://job-boards.greenhouse.io/acme/jobs/123');

  const card = page.locator('outbox-autofill');
  const pane = card.getByRole('dialog', { name: 'Outbox Autofill' });
  const tab = card.getByRole('button', { name: 'Show Outbox Autofill' });
  const minimize = card.getByRole('button', { name: 'Minimize' });
  await expect(card.getByText('Software Engineer')).toBeVisible();
  await minimize.click();
  await expect(pane).toBeHidden();

  // Another posting's form, in place: the card reads it, where a closed one would open for it, and stays aside.
  await page.locator('#next').click();
  await expect(card.locator('.title')).toContainText('Data Engineer');
  await page.waitForTimeout(1500);
  await expect(pane).toBeHidden();
  await expect(tab).toBeVisible();

  // The owner asks for it at the toolbar button, and fills.
  await press(worker);
  await expect(pane).toBeVisible();
  await expect(tab).toBeHidden();
  await card.getByRole('button', { name: 'Fill', exact: true }).click();
  await expect(page.locator('#first_name')).toHaveValue('Alex');
  await expect(page.locator('#email')).toHaveValue('alex@example.com');
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });

  // Aside again while the owner sends the form: the card comes back to say it's logged.
  await minimize.click();
  await expect(pane).toBeHidden();
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => outbox.quickAdds.length, { timeout: 15_000 }).toBe(1);
  await expect(card.getByText('Logged to Outbox')).toBeVisible();
  await expect(tab).toBeHidden();
});
