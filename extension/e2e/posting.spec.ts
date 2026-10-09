import { expect } from '@playwright/test';
import { seed, serve, test } from './harness';

// A Lever posting: the description and an Apply link, with the form on its own page.
const POSTING = 'https://jobs.lever.co/arcadia/4f7c2a3e-1b2d-4c5e-9f00-123456789abc';
const PAGE =
  '<!doctype html><title>Arcadia Cloud - Agent Infrastructure Engineer</title>' +
  '<div class="posting-page"><div class="posting-headline"><h2>Agent Infrastructure Engineer</h2>' +
  '<div class="posting-categories"><div class="location">San Francisco, CA</div></div></div>' +
  '<div class="section-wrapper"><div class="section page-centered">Build the platform our agents run on.</div>' +
  `</div><a class="postings-btn" href="${POSTING}/apply">Apply for this job</a></div>`;

test('leads a posting’s card with Mark as applied, and logs the posting at that press', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'jobs.lever.co', PAGE, PAGE);
  const page = await context.newPage();
  await page.goto(POSTING);

  const card = page.locator('outbox-autofill');
  // What the owner mostly presses on a posting comes first and stands out; saving it for later is beside it.
  await expect(card.locator('.actions button')).toHaveText(['Mark as applied', 'Save for later'], {
    timeout: 15_000,
  });
  const applied = card.getByRole('button', { name: 'Mark as applied' });
  await expect(applied).toHaveClass('primary');
  await expect(card.getByRole('button', { name: 'Save for later' })).toHaveClass('secondary');

  await applied.click();
  await expect(card.getByText('Logged to Outbox')).toBeVisible();
  expect(outbox.quickAdds.at(-1)).toMatchObject({
    companyName: 'Arcadia Cloud',
    title: 'Agent Infrastructure Engineer',
    accountIds: ['acc-1'],
  });
});

test('saves a posting for later from its page, and takes it back', async ({ context, worker, outbox }) => {
  await seed(worker, outbox.url);
  await serve(context, 'jobs.lever.co', PAGE, PAGE);
  const page = await context.newPage();
  await page.goto(POSTING);

  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: 'Save for later' }).click({ timeout: 15_000 });
  await expect(card.getByText('Saved for later')).toBeVisible();
  expect(outbox.quickAdds.at(-1)).toMatchObject({
    companyName: 'Arcadia Cloud',
    title: 'Agent Infrastructure Engineer',
    accountIds: [],
    channelId: null,
  });

  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(card.getByText('Removed from Outbox')).toBeVisible();
});
