import { expect } from '@playwright/test';
import { fixture, seed, serve, test } from './harness';

const POSTING = 'https://jobs.gem.com/acme-robotics/am9icG9zdDr2DjIQ3bPcrRLp0z2TjYKi';

/**
 * Stands in for Gem's own script at the end: either button sends the application, and the form gives way to the
 * confirmation, on the same address.
 */
const SENDS = `<script>
  for (const button of document.querySelectorAll('button[type="submit"]'))
    button.addEventListener('click', () => {
      document.querySelector('[class*="formContainer"]').innerHTML =
        '<div><div>Congratulations!</div><div>Your application for Software Engineer has been received!</div></div>';
    });
</script>`;

test('opens by itself on a Gem posting, fills its nameless fields, and logs the application', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'jobs.gem.com', fixture('gem/acme.html').replace('</body>', `${SENDS}</body>`), '');
  const page = await context.newPage();
  await page.goto(POSTING);

  // No toolbar button: the card is up with the posting read, and Fill ready.
  const card = page.locator('outbox-autofill');
  await expect(card.getByTitle(/^Acme Robotics · Software Engineer/)).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });

  // A field is a line of text and, after it, a control with no name, id or label of its own.
  const typed = (label: string) =>
    page.locator(`xpath=//span[starts-with(normalize-space(.), "${label}")]/following-sibling::div//input`);
  await expect(typed('First name')).toHaveValue('Alex');
  await expect(typed('Last name')).toHaveValue('Chen');
  await expect(typed('Email')).toHaveValue('alex@example.com');
  await expect(typed('Phone number')).toHaveValue('+1 408-555-0100');
  await expect(typed('LinkedIn URL')).toHaveValue('https://www.linkedin.com/in/alex-chen');
  expect(
    await page
      .locator('input[type="file"]')
      .evaluateAll((uploads: HTMLInputElement[]) => uploads.map((upload) => upload.files?.[0]?.name ?? null)),
    // The resume, and neither the cover letter nor the portfolio.
  ).toEqual(['Alex_Chen_Resume.pdf', null, null]);
  // Its radios share no name either: the question is the block they sit in. On OPT, sponsorship comes later.
  await expect(page.getByLabel('Yes', { exact: true })).toBeChecked();
  await expect(page.getByLabel('N/A', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('LinkedIn', { exact: true })).toBeChecked();
  await expect(card.getByTitle('Check: Do you agree to our candidate privacy notice?')).toBeVisible();
  await expect(card.getByTitle('Fill: How would you rate your Python?')).toBeVisible();

  // The second of its two buttons counts as sending it, as the first does.
  await page.getByRole('button', { name: 'Apply without saving' }).click();
  await expect.poll(() => outbox.quickAdds.length, { timeout: 15_000 }).toBe(1);
  expect(outbox.quickAdds[0]).toMatchObject({
    companyName: 'Acme Robotics',
    title: 'Software Engineer',
    url: POSTING,
    accountIds: ['acc-1'],
  });
  await expect(card.getByText('Logged to Outbox')).toBeVisible();
});

test('takes the company’s own name once Gem writes it into the page, a moment after the form', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  // Gem draws the form, asks whether the board tells search engines of its postings, and only then writes the data.
  const data = JSON.stringify({ '@type': 'JobPosting', hiringOrganization: { name: 'ACME robotics.ai' } });
  const later = `<script>
    setTimeout(() => {
      const data = document.createElement('script');
      data.type = 'application/ld+json';
      data.textContent = ${JSON.stringify(data)};
      document.head.append(data);
    }, 1500);
  </script>`;
  const page = await context.newPage();
  await serve(
    context,
    'jobs.gem.com',
    fixture('gem/acme.html')
      .replace(/<script type="application\/ld\+json">.*?<\/script>/s, '')
      .replace('</body>', `${later}</body>`),
    '',
  );
  await page.goto(POSTING);

  const card = page.locator('outbox-autofill');
  // Until then, the board's name in the address.
  await expect(card.getByTitle(/^Acme Robotics · Software Engineer/)).toBeVisible({ timeout: 15_000 });
  await expect(card.getByTitle(/^ACME robotics\.ai · Software Engineer/)).toBeVisible();
});
