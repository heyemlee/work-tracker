import { expect, type BrowserContext, type Page } from '@playwright/test';
import { seed, test } from './harness';

// An application on Workday from its posting to the page it ends on, as the owner goes through it. The card is the
// application's the whole way: what it offers on a posting, to mark it applied or to save it, it offers on the
// posting only.

const HOST = 'acme.wd5.myworkdayjobs.com';
const BOARD = '/en-US/External';
const JOB = `${BOARD}/job/San-Jose-CA/Software-Engineer_R123`;

const SHELL =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Careers at Acme</title></head>' +
  '<body><div id="root"></div><script src="/site.js"></script></body></html>';

/**
 * Stands in for a Workday board, whose applications sit behind a sign-in: one page for every address, drawn by the
 * address as its own code does (cx-jobs and candidate-experience-apply-flow 2026.40.17, read 2026-10-12; the names
 * in `data-automation-id` are its own, but for the two headings marked below).
 *
 * - A posting, whose Apply moves on to the application without loading a page.
 * - The application: several steps at one address. Nothing of it is drawn until the job is known, then its frame
 *   with the job's title, then the first step. A step moves on once what it holds is saved: the bar, the step's
 *   name and the foot are the next step's at once, and a spinner stands where its fields will until they have
 *   come. The last step shows the whole to read over, with no field in it, and its button sends the application:
 *   the browser is taken to the candidate's home, a page loaded afresh.
 * - That home, and the list of jobs. Their markup isn't in the code read (the server sends the home's); each has a
 *   heading of its own, and the home's greets the candidate by name, as an owner's screen showed (2026-10-12): it
 *   was there by the time the card read the page, and was taken for a posting's title.
 *
 * What a real page waits for from its server waits here for the spec to let it through (`letThrough`).
 */
const SITE = `
const BOARD = '${BOARD}';
const JOB = '${JOB}';
const field = (id, label) =>
  '<div data-automation-id="formField-' + id + '"><label for="' + id + '">' + label + '<abbr>*</abbr></label>' +
  '<div><input type="text" id="' + id + '" aria-required="true" data-automation-id="' + id + '"></div></div>';
const STEPS = [
  {
    name: 'My Information',
    fields: field('legalNameSection_firstName', 'First Name') + field('legalNameSection_lastName', 'Last Name'),
  },
  { name: 'My Experience', fields: field('linkedinQuestion', 'LinkedIn') },
  { name: 'Review' },
];
const REVIEW =
  '<div data-automation-id="applyFlowReviewPage"><h4>My Information</h4>' +
  '<div><div>First Name</div><div>Alexander</div></div><div><div>Last Name</div><div>Chen</div></div></div>';
const DOT = '<div style="width: 16px; height: 16px"></div>';
const DOTS = '<div style="display: flex; gap: 8px">' + DOT.repeat(3) + '</div>';
const TITLE =
  '<div><button type="button" role="link" data-automation-id="backToJobPosting">Back to Job Posting</button>' +
  '<h2 data-automation-id="jobTitleHeading">Software Engineer</h2></div>';
const root = document.querySelector('#root');
const go = (path, draw) => (event) => {
  event.preventDefault();
  history.pushState(null, '', path);
  draw();
};

let arrive = null;
const data = () => new Promise((come) => (arrive = come));
window.letThrough = () => {
  const come = arrive;
  arrive = null;
  come?.();
  return come !== null;
};

function posting() {
  root.innerHTML =
    '<div data-automation-id="jobPostingPage"><h2 data-automation-id="jobPostingHeader">Software Engineer</h2>' +
    '<p><a href="#" role="button" data-automation-id="adventureButton">Apply</a> ' +
    '<a href="#" id="jobs">Search for Jobs</a></p>' +
    '<div data-automation-id="jobPostingDescription">Build the software our robots run on.</div></div>';
  root.querySelector('[data-automation-id="adventureButton"]').onclick = go(JOB + '/apply/applyManually', apply);
  root.querySelector('#jobs').onclick = go(BOARD, list);
}

function list() {
  // The heading's name is this stand-in's.
  root.innerHTML =
    '<h2 data-automation-id="pageHeader">Search for Jobs</h2>' +
    '<ul><li><a href="#" id="job">Software Engineer</a></li></ul>';
  root.querySelector('#job').onclick = go(JOB, posting);
}

let at = 0;
async function apply() {
  root.innerHTML = '';
  await data();
  root.innerHTML = '<div data-automation-id="applyFlowPage">' + TITLE + '<div>' + DOT + '</div></div>';
  root.querySelector('[data-automation-id="backToJobPosting"]').onclick = go(JOB, posting);
  await data();
  draw(false);
}

function draw(onItsWay) {
  const step = STEPS[at];
  const last = at === STEPS.length - 1;
  const mark = (index) => (index === at ? 'Active' : index < at ? 'Completed' : 'Inactive');
  root.innerHTML =
    '<div data-automation-id="applyFlowPage">' +
    TITLE +
    '<div aria-label="Application Progress"><ol data-automation-id="progressBar">' +
    STEPS.map(
      (one, index) =>
        '<li data-automation-id="progressBar' + mark(index) + 'Step">' +
        (index === at ? '<label>current step ' + (at + 1) + ' of ' + STEPS.length + '</label>' : '') +
        '<label>' + one.name + '</label></li>',
    ).join('') +
    '</ol></div>' +
    '<div><h3 tabindex="-1">' + step.name + '</h3>' +
    (onItsWay ? '<div data-automation-id="applyFlowLoadingPage">' + DOTS + '</div>' : (step.fields ?? REVIEW)) +
    '</div>' +
    '<div data-automation-id="pageFooter">' +
    (at > 0 ? '<button type="button" data-automation-id="pageFooterBackButton">Back</button> ' : '') +
    '<button type="button" data-automation-id="pageFooterNextButton"' + (onItsWay ? ' disabled' : '') + '>' +
    (last ? 'Submit' : 'Save and Continue') + '</button></div></div>';
  root.querySelector('[data-automation-id="backToJobPosting"]').onclick = go(JOB, posting);
  root.querySelector('[data-automation-id="pageFooterNextButton"]').onclick = async (event) => {
    event.currentTarget.disabled = true;
    // The server takes what the step holds.
    await new Promise((done) => setTimeout(done, 200));
    if (last) {
      window.location.pathname = BOARD + '/jobTasks/completed/application';
      return;
    }
    at++;
    draw(true);
    await data();
    draw(false);
  };
}

function home() {
  // The heading's name is this stand-in's. The board's link to this home moves to its own address, in place.
  root.innerHTML =
    '<p><a href="#" id="home">Candidate Home</a></p><h2 data-automation-id="pageHeader">Welcome, Alex Chen</h2>' +
    '<section><h3>My Tasks</h3><p>You have no tasks.</p></section><section><h3>My Applications</h3></section>';
  root.querySelector('#home').onclick = go(BOARD + '/userHome', home);
}

const path = location.pathname;
if (/\\/apply(\\/|$)/.test(path)) void apply();
else if (path.startsWith(BOARD + '/job/')) posting();
else if (/\\/(userHome|jobTasks)(\\/|$)/.test(path)) home();
else list();
`;

async function serveBoard(context: BrowserContext): Promise<void> {
  await context.route(`https://${HOST}/**`, (route) =>
    new URL(route.request().url()).pathname === '/site.js'
      ? route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: SITE })
      : route.fulfill({ contentType: 'text/html; charset=utf-8', body: SHELL }),
  );
}

const named = (id: string) => `[data-automation-id="${id}"]`;

/** Lets what the page is waiting for come: the job an application is for, its first step, the next one. */
const letThrough = (page: Page) =>
  page.evaluate(() => (window as unknown as { letThrough(): boolean }).letThrough());

/**
 * Runs in every page of the tab, and notes each place the card held out what it offers on a posting: a button to
 * mark it applied, or one to save it. It looks every few milliseconds, so one that is there for a moment is seen.
 */
function noteOffers(): void {
  setInterval(() => {
    const card = document.querySelector('outbox-autofill')?.shadowRoot;
    const offered = [...(card?.querySelectorAll('button') ?? [])].some((button) =>
      ['Mark as applied', 'Save for later'].includes(button.textContent ?? ''),
    );
    if (!offered) return;
    const step = document.querySelector('[data-automation-id="progressBarActiveStep"] label:last-child');
    const place = location.pathname.split('/').slice(3).join('/') + (step ? ` (${step.textContent})` : '');
    const places = JSON.parse(sessionStorage.getItem('offered') ?? '[]') as string[];
    if (!places.includes(place)) sessionStorage.setItem('offered', JSON.stringify([...places, place]));
  }, 20);
}
const offered = (page: Page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem('offered') ?? '[]') as string[]);
const forget = (page: Page) => page.evaluate(() => sessionStorage.removeItem('offered'));

test('is the application’s card from Apply to the page it ends on, and a posting’s on the posting only', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  // Outbox takes a moment over the log: long enough for a card that offered to log it meanwhile to be seen.
  outbox.logTakes = 500;
  await serveBoard(context);
  const page = await context.newPage();
  await page.addInitScript(noteOffers);
  await page.goto(`https://${HOST}${JOB}`);

  const card = page.locator('outbox-autofill');
  const pane = card.getByRole('dialog', { name: 'Outbox Autofill' });
  const fill = card.getByRole('button', { name: 'Fill', exact: true });
  const next = page.locator(named('pageFooterNextButton'));
  const onItsWay = page.locator(named('applyFlowLoadingPage'));

  // On the posting, the card is the posting's.
  await expect(card.locator('.actions button')).toHaveText(['Mark as applied', 'Save for later'], {
    timeout: 15_000,
  });

  // The owner applies. Nothing of the application is drawn yet, and the card is its panel already: who applies,
  // with which resume, a button that waits for something to fill, and no word of marking anything applied.
  await page.locator(named('adventureButton')).click();
  await expect(pane).toHaveClass(/\bpanel\b/);
  await expect(card.locator('.actions')).toBeHidden();
  await expect(card.getByRole('radiogroup', { name: 'Account' })).toBeVisible();
  await expect(fill).toBeDisabled();
  // From here on the card offers nothing of a posting's, for however short a time.
  await forget(page);

  // The same once the page shows which job it's for, and until its first step is there.
  await letThrough(page);
  await expect(page.locator(named('jobTitleHeading'))).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(fill).toBeDisabled();
  await letThrough(page);
  await expect(fill).toBeEnabled();
  await fill.click();
  await expect(card.getByText('Filled 2/2 required')).toBeVisible({ timeout: 45_000 });

  // On to the second step. Its fields are on their way: the panel stays, with nothing to fill for now.
  await next.click();
  await expect(onItsWay).toBeVisible();
  await expect(card.getByText('Filled 2/2 required')).toBeHidden();
  await expect(pane).toHaveClass(/\bpanel\b/);
  await expect(fill).toBeDisabled();
  await letThrough(page);
  await expect(fill).toBeEnabled();

  // On to the review, which has nothing to fill: the card says what is left to do, and that the log follows.
  await next.click();
  await expect(onItsWay).toBeVisible();
  await letThrough(page);
  await expect(page.locator(named('applyFlowReviewPage'))).toBeVisible();
  await expect(card.getByText('Nothing to fill on this step.')).toBeVisible();
  await expect(pane).toHaveClass(/\bpanel\b/);
  await expect(fill).toBeHidden();
  // Logging it by hand is a menu away, as on any step.
  await card.getByRole('button', { name: 'More' }).click();
  await expect(card.getByRole('menuitem', { name: 'Log to Outbox' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(outbox.quickAdds).toHaveLength(0);

  // Sent. The page it ends on is the candidate's home: the card says the application was logged, there.
  await next.click();
  await page.waitForURL(/\/jobTasks\/completed\/application$/);
  await expect(card.getByText('Logged to Outbox', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText('Acme · Software Engineer')).toBeVisible();
  expect(outbox.quickAdds).toHaveLength(1);
  expect(outbox.quickAdds[0]).toMatchObject({
    companyName: 'Acme',
    title: 'Software Engineer',
    url: `https://${HOST}${JOB}`,
    accountIds: ['acc-1'],
  });
  // And goes on saying so: the home's greeting is no posting's title.
  await expect(page.getByRole('heading', { name: 'Welcome, Alex Chen' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(card.getByText('Logged to Outbox', { exact: true })).toBeVisible();
  await expect(card.getByText('Acme · Software Engineer')).toBeVisible();

  // The home at its own address, by the board's link and without a page loaded: the log is still the card's to
  // show, and to take back.
  await page.locator('#home').click();
  await page.waitForURL(/\/userHome$/);
  await page.waitForTimeout(2000);
  await expect(card.getByText('Acme · Software Engineer')).toBeVisible();
  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(card.getByText('Removed from Outbox')).toBeVisible();
  expect(outbox.quickAdds).toHaveLength(1);
  expect(await offered(page)).toEqual([]);
});

test('keeps to the application for a posting saved for later, and offers nothing where one logged by hand ends', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serveBoard(context);
  const page = await context.newPage();
  await page.addInitScript(noteOffers);
  await page.goto(`https://${HOST}${JOB}`);

  const card = page.locator('outbox-autofill');
  const pane = card.getByRole('dialog', { name: 'Outbox Autofill' });
  const fill = card.getByRole('button', { name: 'Fill', exact: true });
  const next = page.locator(named('pageFooterNextButton'));

  await card.getByRole('button', { name: 'Save for later' }).click({ timeout: 15_000 });
  await expect(card.getByText('Saved for later')).toBeVisible();

  // Applying to it after all: the card is the application's, not the note that it was saved.
  await page.locator(named('adventureButton')).click();
  await expect(pane).toHaveClass(/\bpanel\b/);
  await expect(card.locator('.done')).toBeHidden();
  await forget(page);
  await letThrough(page);
  for (const step of ['My Information', 'My Experience']) {
    await letThrough(page);
    await expect(page.getByRole('heading', { name: step })).toBeVisible();
    await expect(fill).toBeEnabled();
    await next.click();
    await expect(page.locator(named('applyFlowLoadingPage'))).toBeVisible();
  }
  await letThrough(page);
  await expect(card.getByText('Nothing to fill on this step.')).toBeVisible();
  await expect(card.locator('.done')).toBeHidden();

  // The owner logs it by hand before sending it: the card says so in its title. (Matched exactly: the step's own
  // hint, still showing, says it's "logged to Outbox by itself" once sent.)
  await card.getByRole('button', { name: 'More' }).click();
  await card.getByRole('menuitem', { name: 'Log to Outbox' }).click();
  await expect(card.getByText('Logged to Outbox', { exact: true })).toBeVisible();
  expect(outbox.quickAdds).toHaveLength(2);

  // Sent: it isn't logged twice, and on the home it ends on the card has nothing to offer.
  await next.click();
  await page.waitForURL(/\/jobTasks\/completed\/application$/);
  await expect(page.getByRole('heading', { name: 'Welcome, Alex Chen' })).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(pane).toBeHidden();
  expect(outbox.quickAdds).toHaveLength(2);
  expect(await offered(page)).toEqual([]);
});

test('goes when a posting gives way, in place, to a page of the board that is no posting', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serveBoard(context);
  const page = await context.newPage();
  await page.goto(`https://${HOST}${JOB}`);

  const card = page.locator('outbox-autofill');
  const pane = card.getByRole('dialog', { name: 'Outbox Autofill' });
  await expect(card.locator('.actions button')).toHaveText(['Mark as applied', 'Save for later'], {
    timeout: 15_000,
  });

  // Back to the list of jobs, whose heading is no job's title: there is nothing there for the card.
  await page.locator('#jobs').click();
  await expect(page.getByRole('heading', { name: 'Search for Jobs' })).toBeVisible();
  await expect(pane).toBeHidden();

  // And it's back for the posting opened from there.
  await page.locator('#job').click();
  await expect(card.locator('.actions button')).toHaveText(['Mark as applied', 'Save for later']);
  await expect(card.locator('.title')).toHaveText('Software Engineer');
});

test('comes up as the application’s panel on an application loaded afresh, before its first step is there', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serveBoard(context);
  const page = await context.newPage();
  await page.addInitScript(noteOffers);
  // As after signing in, or loading the page again halfway through.
  await page.goto(`https://${HOST}${JOB}/apply/applyManually`);

  const card = page.locator('outbox-autofill');
  const pane = card.getByRole('dialog', { name: 'Outbox Autofill' });
  const fill = card.getByRole('button', { name: 'Fill', exact: true });

  // Nothing is drawn, and nothing but the address says what the page is.
  await expect(pane).toHaveClass(/\bpanel\b/, { timeout: 15_000 });
  await expect(fill).toBeDisabled();
  // The job's title is: on a page that isn't an application's, that is a posting.
  await letThrough(page);
  await expect(page.locator(named('jobTitleHeading'))).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(pane).toHaveClass(/\bpanel\b/);
  await expect(fill).toBeDisabled();
  await letThrough(page);
  await expect(fill).toBeEnabled();
  expect(await offered(page)).toEqual([]);
});

test('is the application’s panel for a posting already logged from its own card', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serveBoard(context);
  const page = await context.newPage();
  await page.goto(`https://${HOST}${JOB}`);

  const card = page.locator('outbox-autofill');
  const pane = card.getByRole('dialog', { name: 'Outbox Autofill' });
  const fill = card.getByRole('button', { name: 'Fill', exact: true });

  // Marked applied first, and applied to after: the note of the log gives way to the application.
  await card.getByRole('button', { name: 'Mark as applied' }).click({ timeout: 15_000 });
  await expect(card.getByText('Logged to Outbox', { exact: true })).toBeVisible();
  await page.locator(named('adventureButton')).click();
  await expect(pane).toHaveClass(/\bpanel\b/);
  await expect(card.locator('.done')).toBeHidden();
  await letThrough(page);
  await letThrough(page);
  await expect(fill).toBeEnabled();

  // Its last step has nothing to say of a log to come: it is logged.
  for (const step of ['My Experience', 'Review']) {
    await page.locator(named('pageFooterNextButton')).click();
    await expect(page.locator(named('applyFlowLoadingPage'))).toBeVisible();
    await letThrough(page);
    await expect(page.getByRole('heading', { name: step, level: 3 })).toBeVisible();
  }
  await expect(page.locator(named('applyFlowReviewPage'))).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(pane).toHaveClass(/\bpanel\b/);
  await expect(card.locator('.done')).toBeHidden();
  await expect(card.getByText('Nothing to fill on this step.')).toBeHidden();

  // Sent, it isn't logged again.
  await page.locator(named('pageFooterNextButton')).click();
  await page.waitForURL(/\/jobTasks\/completed\/application$/);
  await page.waitForTimeout(2000);
  expect(outbox.quickAdds).toHaveLength(1);
});
