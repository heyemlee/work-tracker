import { expect, type Worker } from '@playwright/test';
import { BUILTIN_CHANNELS } from '../../src/domain/channels';
import { fixture, SNAPSHOT, seed, serve, test } from './harness';

// Indeed's terms forbid automating Indeed Apply: as on LinkedIn, the card reads the posting to log it, and stays that
// posting's on Indeed Apply's steps, filling nothing.

const VIEWJOB = 'https://www.indeed.com/viewjob?jk=5a2e49e6872d0c2b';
const QUESTIONS = 'https://smartapply.indeed.com/beta/indeedapply/form/questions-module/questions/1';

const shell = (title: string, head: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;

/** Made up: a step of Indeed Apply's, its questions partly answered by Indeed, the owner named on it. */
const STEP = shell(
  'Indeed Apply',
  '',
  '<header><span>Alex Chen</span> · <span>alex@example.com</span></header><main>' +
    '<h1>Answer these questions from the employer</h1><form>' +
    '<p><label for="q1">How many years of experience do you have with Python?</label><input id="q1" type="number"></p>' +
    '<p><label for="q2">What city do you live in?</label><input id="q2" value="Santa Clara"></p>' +
    '<fieldset><legend>Are you authorized to work in the United States?</legend>' +
    '<label><input type="radio" name="q3" value="Yes" checked> Yes</label>' +
    '<label><input type="radio" name="q3" value="No"> No</label></fieldset>' +
    '<p><button type="button">Continue</button></p></form>' +
    '<section><p>Your contact information</p><p>Alex Chen</p><p>+1 408-555-0100</p></section></main>',
);

interface Chrome {
  tabs: { query(asked: object): Promise<object[]> };
  action: { onClicked: { dispatch(tab: object): void } };
  storage: { local: { get(key: string): Promise<{ snapshots?: Report[] }> } };
}
interface Report {
  ats: string;
  url: string;
  fields: unknown[];
  html: string;
}

/** The toolbar button, pressed on the tab in front. */
const press = (worker: Worker) =>
  worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as { chrome: Chrome };
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    chrome.action.onClicked.dispatch(tab!);
  });

/** The fill reports kept, newest first. */
const reports = (worker: Worker) =>
  worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as { chrome: Chrome };
    return (await chrome.storage.local.get('snapshots')).snapshots ?? [];
  });

test('logs an Indeed posting from its own card, under Indeed', async ({ context, worker, outbox }) => {
  outbox.snapshot = { ...SNAPSHOT, channels: [...BUILTIN_CHANNELS] };
  await seed(worker, outbox.url);
  const saved = fixture('indeed/viewjob.html');
  await serve(context, 'www.indeed.com', saved, saved);
  const page = await context.newPage();
  await page.goto(VIEWJOB);

  // It comes up by itself on a posting, as on LinkedIn; applying happens on Indeed, so logging it comes first.
  const card = page.locator('outbox-autofill');
  await expect(card.locator('.actions button')).toHaveText(['Log to Outbox', 'Save for later'], {
    timeout: 15_000,
  });
  await expect(card.locator('.title')).toHaveText('Senior Director, Facilities & Engineering');
  await expect(card.getByRole('button', { name: /^Fill/ })).toHaveCount(0);

  await card.getByRole('button', { name: 'Log to Outbox' }).click();
  await expect(card.getByText('Logged to Outbox', { exact: true })).toBeVisible();
  expect(outbox.quickAdds.at(-1)).toMatchObject({
    companyName: 'US AMR-Jones Lang LaSalle Americas, Inc.',
    title: 'Senior Director, Facilities & Engineering',
    url: VIEWJOB,
    channelId: 'ch_indeed',
    accountIds: ['acc-1'],
  });
});

test('stays the posting’s card on the steps of Indeed Apply, to log it there, filling nothing', async ({
  context,
  worker,
  outbox,
}) => {
  outbox.snapshot = { ...SNAPSHOT, channels: [...BUILTIN_CHANNELS] };
  await seed(worker, outbox.url);
  const saved = fixture('indeed/viewjob.html');
  await serve(context, 'www.indeed.com', saved, saved);
  await serve(context, 'smartapply.indeed.com', STEP, STEP);
  const page = await context.newPage();
  await page.goto(VIEWJOB);
  const card = page.locator('outbox-autofill');
  await expect(card.locator('.title')).toHaveText('Senior Director, Facilities & Engineering', {
    timeout: 15_000,
  });

  // "Apply now" takes the tab to Indeed Apply, whose steps name no posting: the card comes up for the one applied
  // to, with its log and nothing to fill or to save for later.
  const apply = await page.getByTestId('viewjob-indeed-apply').getAttribute('href');
  await page.goto(apply!);
  await page.goto(QUESTIONS);
  await expect(card.locator('.title')).toHaveText('Senior Director, Facilities & Engineering', {
    timeout: 15_000,
  });
  await expect(card.locator('.actions button')).toHaveText(['Log to Outbox']);
  await expect(card.getByRole('button', { name: /^Fill/ })).toHaveCount(0);

  // The step can be reported as it is, under the posting.
  await card.getByRole('button', { name: 'More' }).click();
  await expect(card.getByRole('menuitem')).toHaveText(['This page didn’t fill right', 'Settings']);
  await card.getByRole('menuitem', { name: 'This page didn’t fill right' }).click();
  await expect(card.getByText(/^Saved the form’s structure/)).toBeVisible();
  const [report] = await reports(worker);
  expect(report).toMatchObject({ ats: 'indeed', url: QUESTIONS, fields: [] });
  expect(report!.html).toContain('How many years of experience do you have with Python?');
  // Without what Indeed put in, or who the owner is.
  expect(report!.html).not.toMatch(/Santa Clara|checked|Alex|Chen|@example\.com|555/);

  await card.getByRole('button', { name: 'Log to Outbox' }).click();
  await expect(card.getByText('Logged to Outbox', { exact: true })).toBeVisible();
  expect(outbox.quickAdds.at(-1)).toMatchObject({
    companyName: 'US AMR-Jones Lang LaSalle Americas, Inc.',
    title: 'Senior Director, Facilities & Engineering',
    url: VIEWJOB,
    channelId: 'ch_indeed',
  });
});

test('on Indeed Apply opened with no posting before it, waits to be asked, and says why it fills nothing', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'smartapply.indeed.com', STEP, STEP);
  const page = await context.newPage();
  await page.goto(QUESTIONS);
  await page.bringToFront();

  // No posting to be the card of: nothing comes up by itself.
  const pane = page.locator('outbox-autofill').getByRole('dialog', { name: 'Outbox Autofill' });
  await page.waitForTimeout(1500);
  await expect(pane).toHaveCount(0);

  await press(worker);
  await expect(pane.getByText(/^Indeed’s terms don’t allow tools to fill Indeed Apply/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(pane.getByRole('button', { name: /^Fill/ })).toHaveCount(0);
  await pane.getByRole('button', { name: 'More' }).click();
  await expect(pane.getByRole('menuitem')).toHaveText(['This page didn’t fill right', 'Settings']);
  await pane.getByRole('menuitem', { name: 'This page didn’t fill right' }).click();
  await expect(pane.getByText(/^Saved the form’s structure/)).toBeVisible();
  const [report, ...more] = await reports(worker);
  expect(more).toEqual([]);
  expect(report).toMatchObject({ ats: 'indeed', url: QUESTIONS, fields: [] });
  expect(report!.html).toContain('Are you authorized to work in the United States?');
});
