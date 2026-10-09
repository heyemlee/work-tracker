import { expect } from '@playwright/test';
import { fixture, seed, serve, SNAPSHOT, test } from './harness';

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
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });
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
  await expect(card.getByTitle(/^Check: /).first()).toBeVisible();
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
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('input[name="name"]')).toHaveValue('Alexander Chen');
  await expect(page.locator('input[name="org"]')).toHaveValue('Acme AI Labs');
  await expect(page.locator('input[name="phone"]')).toHaveValue('+1 408 555 0100');
  // The email is the account applying, not the resume's.
  await expect(page.locator('input[name="email"]')).toHaveValue('alex@example.com');
  await expect(page.locator('input[name="urls[GitHub]"]')).toHaveValue('https://github.com/alexchen');
});

// What Lever's own script does with an attached resume, with a reader that takes `ms`: "Analyzing resume..." shows
// while it reads, then "Success!", and the fields it found go in wherever nothing was typed since the page loaded.
const reader = (ms: number) => `<style>
    .resume-upload-working, .resume-upload-success, .resume-upload-failure, .resume-upload-oversize { display: none; }
  </style>
  <script>
    (() => {
      const note = (name) => document.querySelector('.resume-upload-' + name);
      const field = (name) => document.querySelector('input[name="' + name + '"]');
      const typed = new Set();
      for (const name of ['name', 'email', 'org']) field(name).addEventListener('change', () => typed.add(name));
      document.querySelector('#application-form, .application-form').addEventListener('change', (event) => {
        if (event.target.id === 'resume-upload-input') window.attachedAt = performance.now();
        else window.answeredAfter ??= performance.now() - window.attachedAt;
      });
      document.querySelector('#resume-upload-input').addEventListener('change', () => {
        note('success').style.display = 'none';
        note('working').style.display = 'inline';
        setTimeout(() => {
          note('working').style.display = 'none';
          note('success').style.display = 'inline';
          for (const [name, value] of [['name', 'Alexander Chen'], ['email', 'alex.chen@gmail.com'], ['org', 'Acme AI Labs']]) {
            if (!typed.has(name)) field(name).value = value;
          }
        }, ${ms});
      });
    })();
  </script>`;

for (const [pace, ms] of [
  ['at once', 300],
  ['late', 3500],
] as const) {
  test(`goes on when Lever has read the resume, ${pace}, and keeps what it read`, async ({
    context,
    worker,
    outbox,
  }) => {
    await seed(worker, outbox.url);
    await serve(
      context,
      'jobs.lever.co',
      fixture('lever/palantir.html').replace('</body>', `${reader(ms)}</body>`),
      THANKS,
    );
    const page = await context.newPage();
    await page.goto('https://jobs.lever.co/palantir/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2/apply');

    const card = page.locator('outbox-autofill');
    await card.getByRole('button', { name: /^Fill/ }).click();
    await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });
    // A fill that went on before the read was over would have typed the profile's name and company first, and
    // Lever leaves alone what was typed.
    await expect(page.locator('input[name="name"]')).toHaveValue('Alexander Chen');
    await expect(page.locator('input[name="org"]')).toHaveValue('Acme AI Labs');
    await expect(page.locator('input[name="email"]')).toHaveValue('alex@example.com');
    // The next answer came once the read was over, and not a set time later.
    const answeredAfter = await page.evaluate(
      () => (window as unknown as { answeredAfter: number }).answeredAfter,
    );
    expect(answeredAfter).toBeGreaterThanOrEqual(ms);
    expect(answeredAfter).toBeLessThan(ms + 1500);
  });
}

test('attaches the resume once: filling again doesn’t have Lever read it a second time', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(
    context,
    'jobs.lever.co',
    fixture('lever/palantir.html').replace('</body>', `${reader(300)}</body>`),
    THANKS,
  );
  const page = await context.newPage();
  await page.goto('https://jobs.lever.co/palantir/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2/apply');
  await page.evaluate(() => {
    const scope = window as unknown as { attached: number };
    scope.attached = 0;
    document.querySelector('#resume-upload-input')?.addEventListener('change', () => scope.attached++);
  });
  const attached = () => page.evaluate(() => (window as unknown as { attached: number }).attached);

  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });
  expect(await attached()).toBe(1);

  await card.getByRole('button', { name: 'Fill again' }).click();
  await expect(card.locator('.progress')).toBeVisible();
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });
  expect(await attached()).toBe(1);
  // The resume is still there, and so is what Lever read from it.
  expect(
    await page.locator('#resume-upload-input').evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
  ).toBe('Alex_Chen_Resume.pdf');
  await expect(page.locator('input[name="name"]')).toHaveValue('Alexander Chen');
  await expect(card.locator('.item', { hasText: 'Resume' }).first()).toContainText('Alex_Chen_Resume.pdf');
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
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('#_systemfield_name')).toHaveValue('Alex Chen');
  await expect(page.locator('#_systemfield_email')).toHaveValue('alex@example.com');
  await expect(page.getByLabel('LinkedIn Profile')).toHaveValue('https://www.linkedin.com/in/alex-chen');
  await expect(page.getByLabel('Decline to self-identify').first()).toBeChecked();
  await expect(page.getByLabel('LinkedIn', { exact: true })).toBeChecked();
  await page.locator('outbox-autofill .card').screenshot({ path: 'e2e/output/ashby-card.png' });
});

test('says first that a posting was applied to before: who did, when, and what a second account risks', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  const at = '2026-09-01T00:00:00.000Z';
  const day = new Date(Date.now() - 3 * 86_400_000);
  outbox.snapshot = {
    ...SNAPSHOT,
    accounts: [
      ...SNAPSHOT.accounts,
      { ...SNAPSHOT.accounts[0]!, id: 'acc-2', email: 'alex.chen@example.org', color: 'purple' },
    ],
    companies: [{ id: 'com-1', name: 'Notion', createdAt: at }],
    jobs: [
      {
        id: 'job-1',
        companyId: 'com-1',
        title: 'Software Engineer, Developer Platform',
        url: 'https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a',
        notes: '',
        createdAt: at,
        updatedAt: at,
      },
    ],
    applications: [
      {
        id: 'app-1',
        jobId: 'job-1',
        accountId: 'acc-2',
        channelId: null,
        resumeId: null,
        stage: 'applied',
        rejected: false,
        appliedAt: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
        source: 'user',
        createdAt: at,
        updatedAt: at,
      },
    ],
  };
  await serve(context, 'jobs.ashbyhq.com', fixture('ashby/notion.html'), THANKS);
  const page = await context.newPage();
  await page.goto('https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a/application');

  const card = page.locator('outbox-autofill');
  const said = card.getByRole('status');
  await expect(said).toContainText('Already applied to this posting');
  await expect(said).toContainText('alex.chen@example.org');
  await expect(said).toContainText('3 days ago');
  // Ashby merges candidates by name: the account still free to apply is one more of the same person.
  await expect(said).toContainText('a second account may count as a duplicate');
  // It stands above the accounts, where the one that applied can't be chosen.
  expect(
    await said.evaluate(
      (line) =>
        line.compareDocumentPosition(line.parentElement!.querySelector('[role="radiogroup"]')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ),
  ).toBeTruthy();
  await expect(card.getByRole('radio', { name: /alex\.chen@example\.org/ })).toBeDisabled();
  await expect(card.getByRole('radio', { name: 'alex@example.com' })).toBeChecked();
});

// Ashby saves each answer to its server as it changes, and there saves that overlap overwrite each other: a form
// filled all at once showed every answer, then reported some missing on submit. This stand-in saves the way Ashby
// does (a text half a second after typing stops, a choice at once) to a server that loses overlapping saves.
const SAVING_FORM = `<!doctype html><html><head><title>Software Engineer @ Acme</title></head><body>
<h1>Software Engineer</h1>
<div id="form"><div class="ashby-application-form-container">
  <div class="ashby-application-form-field-entry" data-field-path="_systemfield_name">
    <label class="ashby-application-form-question-title _required_1" for="_systemfield_name">Name</label>
    <input id="_systemfield_name" name="_systemfield_name" type="text" required></div>
  <div class="ashby-application-form-field-entry" data-field-path="_systemfield_email">
    <label class="ashby-application-form-question-title _required_1" for="_systemfield_email">Email</label>
    <input id="_systemfield_email" name="_systemfield_email" type="email" required></div>
  <div class="ashby-application-form-field-entry" data-field-path="question_1">
    <label class="ashby-application-form-question-title _required_1" for="question_1">LinkedIn Profile</label>
    <input id="question_1" name="question_1" type="text" required></div>
  <div class="ashby-application-form-field-entry" data-field-path="question_2">
    <label class="ashby-application-form-question-title _required_1">Are you legally authorized to work in the US?</label>
    <div class="ashby-application-form-input-yesno"><button type="button" aria-pressed="false" data-option="yes">Yes</button><button type="button" aria-pressed="false" data-option="no">No</button></div></div>
  <div class="ashby-application-form-field-entry" data-field-path="question_3">
    <label class="ashby-application-form-question-title _required_1">Do you now or will you in the future require sponsorship for work authorization in the US?</label>
    <div class="ashby-application-form-input-yesno"><button type="button" aria-pressed="false" data-option="yes">Yes</button><button type="button" aria-pressed="false" data-option="no">No</button></div></div>
  <div class="ashby-application-form-field-entry" data-field-path="question_4">
    <label class="ashby-application-form-question-title _required_1">Are you able to work in the San Francisco office in SOMA? We default to being in-office 3 days a week.</label>
    <div class="ashby-application-form-input-yesno"><button type="button" aria-pressed="false" data-option="yes">Yes</button><button type="button" aria-pressed="false" data-option="no">No</button></div></div>
  <button class="ashby-application-form-submit-button" type="button">Submit Application</button>
</div></div>
<script>
  const api = (op, body) => fetch('/api/non-user-graphql?op=' + op, { method: 'POST', body: JSON.stringify(body) });
  api('ApiJobPosting', {});
  const save = (path, value) => api('ApiSetFormValue', { path, value });
  for (const input of document.querySelectorAll('input')) {
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => save(input.name, input.value), 500);
    });
  }
  for (const group of document.querySelectorAll('.ashby-application-form-input-yesno')) {
    const path = group.closest('[data-field-path]').dataset.fieldPath;
    for (const button of group.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        for (const other of group.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
        save(path, button.dataset.option === 'yes');
      });
    }
  }
</script></body></html>`;

test('fills an Ashby form one saved answer at a time, so none is lost', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'jobs.ashbyhq.com', SAVING_FORM, THANKS);
  // Each save reads what the server holds, and writes it back with its answer a moment later.
  let saved: Record<string, unknown> = {};
  await context.route('https://jobs.ashbyhq.com/api/non-user-graphql**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { path?: string; value?: unknown };
    if (body.path) {
      const read = { ...saved };
      await new Promise((done) => setTimeout(done, 250));
      saved = { ...read, [body.path]: body.value };
    }
    await route.fulfill({ contentType: 'application/json', body: '{"data":{}}' });
  });
  const page = await context.newPage();
  await page.goto('https://jobs.ashbyhq.com/acme/3f1c0d7e-8a53-4c1e-9d0b-2b7f6c1e0a11/application');

  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(() => saved, { timeout: 5_000 })
    .toEqual({
      _systemfield_name: 'Alex Chen',
      _systemfield_email: 'alex@example.com',
      question_1: 'https://www.linkedin.com/in/alex-chen',
      question_2: true,
      question_3: true,
      question_4: true,
    });
});
