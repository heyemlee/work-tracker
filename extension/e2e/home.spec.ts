import { expect, type Worker } from '@playwright/test';
import { seed, serve, test } from './harness';

// The toolbar button on pages that are no application: the card it brings up there is the extension's own, not a
// job's made up from whatever the page is called; and where the browser lets no card be drawn, the button says so.

const shell = (title: string, head: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;

/** The owner's mail: it has a title and a site's name, as any page has, and is no job. */
const MAIL = shell(
  'Inbox (3) - alex@example.com - Example Mail',
  '<meta property="og:site_name" content="Example Mail">',
  '<main><p>Acme Robotics Recruiting: we would like to schedule an interview.</p></main>',
);
/** A posting on a company's own site, at an address that says what it is. */
const POSTING = shell(
  'Software Engineer, Platform - Acme Robotics',
  '<meta property="og:site_name" content="Acme Robotics"><meta property="og:title" content="Software Engineer, Platform">',
  '<main><h1>Software Engineer, Platform</h1><p>Build the platform our robots run on.</p></main>',
);
/** A posting at an address that says nothing, marked up as one for search engines. */
const MARKED = shell(
  'Backend Engineer | Globex',
  '<meta property="og:site_name" content="Globex"><script type="application/ld+json">' +
    '{"@context":"https://schema.org","@type":"JobPosting","title":"Backend Engineer"}</script>',
  '<main><h1>Backend Engineer</h1><p>Come build with us.</p></main>',
);
/** A sign-up: a form with a name and an email in it, and nothing of an application about it. */
const SIGN_UP = shell(
  'Sign up - Example SaaS',
  '<meta property="og:site_name" content="Example SaaS">',
  '<main><form><p><label for="first">First name</label><input id="first" name="first_name" required></p>' +
    '<p><label for="last">Last name</label><input id="last" name="last_name" required></p>' +
    '<p><label for="email">Email</label><input id="email" name="email" type="email" required></p>' +
    '<p><label for="phone">Phone</label><input id="phone" name="phone" type="tel"></p>' +
    '<p><label for="team">Team size</label><input id="team" name="team_size"></p>' +
    '<p><button type="submit">Sign up</button></p></form></main>',
);
/** A Greenhouse board's list of openings: the company's, and no posting. */
const BOARD = shell(
  'Jobs at Acme',
  '',
  '<main><h1>Current openings</h1><ul><li><a href="/acme/jobs/123">Software Engineer, Platform</a></li></ul></main>',
);

interface Chrome {
  tabs: { query(asked: object): Promise<{ id: number }[]> };
  action: {
    onClicked: { dispatch(tab: object): void };
    getPopup(details: { tabId: number }): Promise<string>;
  };
  runtime: { getContexts(filter: { contextTypes: string[] }): Promise<{ documentUrl: string }[]> };
}
/** The toolbar button, pressed on the tab in front. */
const press = (worker: Worker) =>
  worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as { chrome: Chrome };
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    chrome.action.onClicked.dispatch(tab!);
  });

test('brings up the extension’s own card on a page that is no job’s', async ({ context, worker, outbox }) => {
  await seed(worker, outbox.url);
  await serve(context, 'mail.example.com', MAIL, MAIL);
  const page = await context.newPage();
  await page.goto('https://mail.example.com/u/0/');
  await page.bringToFront();

  // Nothing comes up by itself there.
  const card = page.locator('outbox-autofill');
  await expect(card).toHaveCount(0);
  await press(worker);
  const pane = card.getByRole('dialog', { name: 'Outbox Autofill' });
  await expect(pane.getByText('No application form on this page.')).toBeVisible({ timeout: 15_000 });
  // It doesn't take the page for a job, by its title or anything else.
  await expect(pane.locator('.title')).toHaveText('Outbox Autofill');
  await expect(pane.getByRole('button', { name: 'Mark as applied' })).toHaveCount(0);
  await expect(pane.getByRole('button', { name: /^Fill/ })).toHaveCount(0);
  await expect(pane.getByRole('radiogroup', { name: 'Account' })).toHaveCount(0);

  // What needs no application: the resumes, with their look; the profile, in its window; the way to Outbox.
  await expect(pane.getByRole('radio', { name: 'SDE-v3' })).toBeChecked();
  await expect(pane.getByRole('button', { name: 'Preview SDE-v3' })).toBeVisible();
  const outboxRow = pane.getByRole('link', { name: 'Open my applications' });
  await expect(outboxRow).toHaveAttribute('href', outbox.url);
  await expect(outboxRow).toHaveAttribute('target', '_blank');
  await pane.getByRole('button', { name: /^Alex Chen/ }).click();
  const profile = card.getByRole('dialog', { name: 'Your autofill information' });
  await expect(profile.getByLabel('Legal first name')).toHaveValue('Alex');
  await profile.getByRole('button', { name: 'Close' }).click();

  // What it could still do with the page waits in the menu: there is no form here to call an application.
  await pane.getByRole('button', { name: 'More' }).click();
  await expect(pane.getByRole('menuitem')).toHaveText(['Log to Outbox', 'Settings']);
});

test('keeps a posting’s card where the address, or the page itself, says it’s a job', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'www.acme-robotics.com', POSTING, POSTING);
  await serve(context, 'www.globex.example', MARKED, MARKED);
  const page = await context.newPage();
  const card = page.locator('outbox-autofill');

  for (const [address, title] of [
    ['https://www.acme-robotics.com/careers/platform-engineer', 'Software Engineer, Platform'],
    ['https://www.globex.example/company/work-with-us/9912', 'Backend Engineer'],
  ] as const) {
    await page.goto(address);
    await page.bringToFront();
    await press(worker);
    await expect(card.locator('.actions button')).toHaveText(['Mark as applied', 'Save for later'], {
      timeout: 15_000,
    });
    await expect(card.locator('.title')).toHaveText(title);
    await expect(card.getByText('No application form on this page.')).toHaveCount(0);
  }
});

test('reads a form as an application once the owner says the page is one, and fills it', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'www.saas.example', SIGN_UP, SIGN_UP);
  const page = await context.newPage();
  await page.goto('https://www.saas.example/signup');
  await page.bringToFront();
  await press(worker);

  // A sign-up is no application, whatever it asks: nothing to fill, until the owner says otherwise.
  const pane = page.locator('outbox-autofill').getByRole('dialog', { name: 'Outbox Autofill' });
  await expect(pane.getByText('No application form on this page.')).toBeVisible({ timeout: 15_000 });
  await expect(pane.getByRole('button', { name: /^Fill/ })).toHaveCount(0);
  await pane.getByRole('button', { name: 'More' }).click();
  await pane.getByRole('menuitem', { name: 'Treat this page as an application' }).click();

  // The card is an application's from here: who applies, and Fill.
  await expect(pane.getByRole('radiogroup', { name: 'Account' })).toBeVisible();
  await expect(pane.getByText('No application form on this page.')).toHaveCount(0);
  await pane.getByRole('button', { name: /^Fill/ }).click();
  await expect(page.locator('#first')).toHaveValue('Alex');
  await expect(page.locator('#email')).toHaveValue('alex@example.com');
});

test('on a hiring system’s page that is no posting, waits to be asked and is the extension’s own then', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'job-boards.greenhouse.io', BOARD, BOARD);
  const page = await context.newPage();
  await page.goto('https://job-boards.greenhouse.io/acme');
  await page.bringToFront();

  // The script runs on these hosts from the start, and the card stays away from a list of openings.
  const pane = page.locator('outbox-autofill').getByRole('dialog', { name: 'Outbox Autofill' });
  await page.waitForTimeout(1500);
  await expect(pane).toHaveCount(0);
  await press(worker);
  await expect(pane.getByText('No application form on this page.')).toBeVisible({ timeout: 15_000 });
  await expect(pane.getByRole('button', { name: 'Mark as applied' })).toHaveCount(0);
});

test('says so under the button where the browser lets no card be drawn', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  const page = await context.newPage();
  await page.goto('chrome://newtab/').catch(() => undefined);
  await page.bringToFront();
  await press(worker);

  // The button's own small window, for this press only: the next one is the card's again.
  const bubble = new URL('/bubble.html', worker.url()).href;
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const { chrome } = globalThis as unknown as { chrome: Chrome };
        const popups = await chrome.runtime.getContexts({ contextTypes: ['POPUP'] });
        return popups.map((popup) => popup.documentUrl);
      }),
    )
    .toEqual([bubble]);
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const { chrome } = globalThis as unknown as { chrome: Chrome };
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return chrome.action.getPopup({ tabId: tab!.id });
      }),
    )
    .toBe('');

  // What it says, read where a spec can read it: the same page in a tab. It offers what needs no page, and each
  // of the two opens in a tab of its own.
  for (const [button, address] of [
    ['Open Outbox', outbox.url],
    ['Settings', new URL('/options.html', worker.url()).href],
  ] as const) {
    const shown = await context.newPage();
    await shown.goto(bubble);
    await expect(shown.getByText('The browser lets no extension show anything on this page')).toBeVisible();
    const opened = context.waitForEvent('page');
    await shown.getByRole('button', { name: button }).click();
    expect((await opened).url()).toContain(address);
  }
});
