import { expect, type Page } from '@playwright/test';
import { fixture, seed, serve, test } from './harness';

const POSTING = 'https://jobs.gem.com/acme-robotics/am9icG9zdDr2DjIQ3bPcrRLp0z2TjYKi';

/**
 * Stands in for Gem's own script where the saved page needs it. Round an upload, as its page was seen to behave: a
 * file the input takes is named over the box a moment later, beside a ✕ that forgets it while the input keeps its
 * own, and a file dropped onto the box is named without the input ever holding it. A rating's number shows it's
 * pressed by its classes alone, as Gem's own code draws it. At the end: either button sends the application, and
 * the form gives way to the confirmation, on the same address.
 */
const GEM = `<script>
  for (const box of document.querySelectorAll('[class*="formContainer"] [role="presentation"]')) {
    const input = box.querySelector('input[type="file"]');
    const outer = box.parentElement.parentElement;
    const holds = (name) => {
      outer.parentElement.querySelector('[class*="fileContainer"]')?.remove();
      if (name) {
        outer.insertAdjacentHTML(
          'beforebegin',
          '<div class="fileContainer-163"><div class="body-41 primary-44"></div>' +
            '<button type="button" aria-label="cross" style="width: 16px; height: 16px"></button></div>',
        );
        const shown = outer.previousElementSibling;
        shown.firstElementChild.textContent = name;
        shown.lastElementChild.addEventListener('click', () => holds(null));
      }
      box.querySelector('[class*="promptText"]').textContent =
        'Click to ' + (name ? 'replace' : 'upload') + ' or drag and drop here';
    };
    input.addEventListener('change', () => {
      const name = input.files[0]?.name;
      setTimeout(() => holds(name), 3);
    });
    box.addEventListener('drop', (event) => holds(event.dataTransfer.files[0]?.name));
  }
  // A rating's number, pressed, turns "primary" and "selected", and the one pressed before goes back to "secondary".
  for (const group of document.querySelectorAll('[class*="inputGroup-"]')) {
    const buttons = [...group.querySelectorAll('button')];
    for (const button of buttons)
      button.addEventListener('click', () => {
        for (const other of buttons) {
          other.classList.replace('primary-132', 'secondary-133');
          other.classList.remove('selected');
        }
        button.classList.replace('secondary-133', 'primary-132');
        button.classList.add('selected');
      });
  }
  for (const button of document.querySelectorAll('button[type="submit"]'))
    button.addEventListener('click', () => {
      document.querySelector('[class*="formContainer"]').innerHTML =
        '<div><div>Congratulations!</div><div>Your application for Software Engineer has been received!</div></div>';
    });
</script>`;

/** The saved page with that script at its end. */
const formPage = () => fixture('gem/acme.html').replace('</body>', `${GEM}</body>`);

test('opens by itself on a Gem posting, fills its nameless fields, and logs the application', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'jobs.gem.com', formPage(), '');
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
  // Not asked for, so left to the owner.
  await expect(typed('LinkedIn URL')).toHaveValue('');
  expect(
    await page
      .locator('input[type="file"]')
      .evaluateAll((uploads: HTMLInputElement[]) => uploads.map((upload) => upload.files?.[0]?.name ?? null)),
    // The resume, and neither the cover letter nor the portfolio.
  ).toEqual(['Alex_Chen_Resume.pdf', null, null]);
  // Gem names the file it took, over the upload's box.
  await expect(page.locator('[class*="fileContainer"]')).toHaveText(['Alex_Chen_Resume.pdf']);
  // Its radios share no name either: the question is the block they sit in. On OPT, sponsorship comes later.
  await expect(page.getByLabel('Yes', { exact: true })).toBeChecked();
  await expect(page.getByLabel('N/A', { exact: true })).not.toBeChecked();
  // "How did you hear about us?" isn't asked for either.
  await expect(page.getByLabel('LinkedIn', { exact: true })).not.toBeChecked();
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

test('goes by what Gem shows of the resume: taken out at its ✕, it’s asked for again and attached again', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'jobs.gem.com', formPage(), '');
  const page = await context.newPage();
  await page.goto(POSTING);

  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });

  const resume = page.locator('xpath=//span[starts-with(normalize-space(.), "Resume")]/parent::div');
  const named = resume.locator('[class*="fileContainer"]');
  const inInput = () =>
    resume
      .locator('input[type="file"]')
      .evaluate((input: HTMLInputElement) => input.files?.[0]?.name ?? null);
  // The card's line for the resume, done or to fill.
  const done = card.getByTitle('Resume', { exact: true });
  const wanted = card.getByTitle('Fill: Resume');
  // "Fill again", through to the end: the fill's bar stands where the list was, and gives way to it again.
  const fillAgain = async () => {
    const bar = card.getByRole('progressbar', { name: /^(Reading the page|Filling)$/ });
    await card.getByRole('button', { name: 'Fill again' }).click();
    await expect(bar).toBeVisible();
    await expect(bar).toBeHidden({ timeout: 45_000 });
  };
  await expect(named).toHaveText('Alex_Chen_Resume.pdf');
  await expect(done).toContainText('Alex_Chen_Resume.pdf');
  await expect(card.getByText('Filled 8/11 required')).toBeVisible();

  // Gem's own ✕: the page holds no resume now, though the input still does. The card says what the page does.
  await named.getByRole('button', { name: 'cross' }).click();
  await expect(named).toHaveCount(0);
  expect(await inInput()).toBe('Alex_Chen_Resume.pdf');
  await expect(wanted).toContainText('Required');
  await expect(card.getByText('Filled 7/11 required')).toBeVisible();

  await fillAgain();
  await expect(named).toHaveText('Alex_Chen_Resume.pdf');
  await expect(done).toContainText('Alex_Chen_Resume.pdf');
  await expect(card.getByText('Filled 8/11 required')).toBeVisible();

  // The owner's own file, dropped onto the box: Gem holds it and the input never gets it. It's theirs, and stays.
  const dropped = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['%PDF-1.4'], 'Dropped_By_Hand.pdf', { type: 'application/pdf' }));
    return data;
  });
  await resume.locator('[role="presentation"]').dispatchEvent('drop', { dataTransfer: dropped });
  await expect(done).toContainText('Dropped_By_Hand.pdf');
  await fillAgain();
  await expect(named).toHaveText('Dropped_By_Hand.pdf');
  await expect(done).toContainText('Dropped_By_Hand.pdf');
  expect(await inInput()).toBe('Alex_Chen_Resume.pdf');
});

test('remembers a rating pressed by hand once the form is sent, and presses it the next time', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'jobs.gem.com', formPage(), '');
  const QUESTION = 'How would you rate your Python?';
  // The rating's numbers, and the ones Gem draws as pressed.
  const numbers = (page: Page) =>
    page.locator(
      `xpath=//span[starts-with(normalize-space(.), "${QUESTION}")]/parent::div/following-sibling::div//button`,
    );
  const pressed = (page: Page) =>
    numbers(page).evaluateAll((buttons) =>
      buttons.filter((button) => button.classList.contains('selected')).map((button) => button.textContent),
    );
  // A press of the owner's: the card lies over part of the form, and the press is meant for the page.
  const press = (page: Page, number: string) =>
    numbers(page).getByText(number, { exact: true }).dispatchEvent('click');
  const fillAgain = async (page: Page) => {
    const card = page.locator('outbox-autofill');
    const bar = card.getByRole('progressbar', { name: /^(Reading the page|Filling)$/ });
    await card.getByRole('button', { name: 'Fill again' }).click();
    await expect(bar).toBeVisible();
    await expect(bar).toBeHidden({ timeout: 45_000 });
  };
  const remembered = () =>
    worker.evaluate(async () => {
      const { chrome } = globalThis as unknown as {
        chrome: { storage: { local: { get(key: string): Promise<{ memory?: unknown[] }> } } };
      };
      return (await chrome.storage.local.get('memory')).memory ?? [];
    });

  const page = await context.newPage();
  await page.goto(POSTING);
  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });
  // Nothing knows the answer: the owner gives it.
  await expect(card.getByTitle(`Fill: ${QUESTION}`)).toBeVisible();
  expect(await pressed(page)).toEqual([]);
  await press(page, '4');
  // The card's list follows, with the number.
  await expect(card.getByTitle(QUESTION, { exact: true })).toContainText('4');
  await fillAgain(page);
  expect(await pressed(page)).toEqual(['4']);
  await expect(card.getByTitle(QUESTION, { exact: true })).toContainText('4');

  await page.getByRole('button', { name: 'Apply without saving' }).click();
  await expect.poll(remembered, { timeout: 15_000 }).toContainEqual(
    expect.objectContaining({
      label: QUESTION,
      answer: expect.objectContaining({ type: 'choice', option: '4' }),
    }),
  );

  // The same question on the next visit: the owner's number goes in, and stays through "Fill again".
  const next = await context.newPage();
  await next.goto(POSTING);
  const nextCard = next.locator('outbox-autofill');
  await nextCard.getByRole('button', { name: /^Fill/ }).click();
  await expect(nextCard.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });
  expect(await pressed(next)).toEqual(['4']);
  await expect(nextCard.getByTitle(QUESTION, { exact: true })).toContainText('4');
  await fillAgain(next);
  expect(await pressed(next)).toEqual(['4']);
  // Another number pressed by hand in its place is theirs: "Fill again" leaves it.
  await press(next, '2');
  await expect(nextCard.getByTitle(QUESTION, { exact: true })).toContainText('2');
  await fillAgain(next);
  expect(await pressed(next)).toEqual(['2']);
  await expect(nextCard.getByTitle(QUESTION, { exact: true })).toContainText('2');
});
