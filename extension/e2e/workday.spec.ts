import { expect, type BrowserContext } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { makeProfile } from '../src/test/profiles';
import { seed, test } from './harness';

const HOST = 'acme.wd5.myworkdayjobs.com';
const APPLY = `https://${HOST}/en-US/External/job/San-Jose-CA/Software-Engineer_R123/apply/applyManually`;
const SHELL =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Software Engineer</title></head>' +
  '<body><div id="root"></div><script src="/page.js"></script></body></html>';

/** The stand-in page's code (workday-page.tsx), bundled once for the browser. */
let bundled: Promise<string> | undefined;
function pageCode(): Promise<string> {
  bundled ??= build({
    configFile: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve(dirname(fileURLToPath(import.meta.url)), 'workday-page.tsx'),
        formats: ['iife'],
        name: 'WorkdayPage',
      },
    },
  }).then((built) => {
    const [result] = Array.isArray(built) ? built : [built];
    const code = result && 'output' in result ? result.output[0].code : null;
    if (!code) throw new Error('The stand-in Workday page didn’t build.');
    return code;
  });
  return bundled;
}

async function serveWorkday(context: BrowserContext): Promise<void> {
  const code = await pageCode();
  await context.route(`https://${HOST}/**`, (route) =>
    new URL(route.request().url()).pathname === '/page.js'
      ? route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: code })
      : route.fulfill({ contentType: 'text/html; charset=utf-8', body: SHELL }),
  );
}

/** An applicant with these answers to the voluntary questions; Outbox hands the extension the newest. */
const applicant = (eeo: { race: 'asian' | 'white'; disability: 'yes' | 'no' }) =>
  makeProfile({ eeo }) as unknown as Record<string, unknown>;

// Local, as the extension counts today and as Workday checks the date.
const today = () => new Date().toLocaleDateString('en-CA');

test('answers Workday’s groups of boxes and dates the disability form today, as the form takes them', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  outbox.profiles.push(applicant({ race: 'asian', disability: 'no' }));
  await serveWorkday(context);
  const page = await context.newPage();
  await page.goto(APPLY);
  const card = page.locator('outbox-autofill');
  // What the form holds, as it would send it: a box drawn ticked or a date shown isn't yet an answer taken.
  const sent = async () => JSON.parse((await page.locator('#sent').textContent()) ?? '{}') as unknown;
  const filled = {
    ethnicityMulti: [{ id: 'a2' }],
    disabilityStatus: { id: 'd2' },
    dateSignedOn: today(),
    name: 'Alexander Chen',
  };
  const again = async () => {
    await card.getByRole('button', { name: 'Fill again' }).click();
    const bar = card.getByRole('progressbar', { name: /^(Reading the page|Filling)$/ });
    await expect(bar).toBeVisible();
    await expect(bar).toBeHidden({ timeout: 45_000 });
  };

  // The owner has typed their name already, so the date is the last thing the fill writes: nothing after it takes
  // the focus away, and the form gets a date only as its field is left.
  await page.getByLabel('Name').fill('Alexander Chen');
  await card.getByRole('button', { name: /^Fill/ }).click({ timeout: 15_000 });
  await expect(card.getByText('Filled 4/4 required')).toBeVisible({ timeout: 45_000 });
  await expect.poll(sent).toEqual(filled);
  await expect(page.locator('#errors')).toHaveText('');
  // Each is listed under its own question, with what went in.
  await expect(
    card.getByText('Please indicate your race / ethnic group (choose all that apply).'),
  ).toBeVisible();
  await expect(card.getByText('Asian (Not Hispanic or Latino) (United States of America)')).toBeVisible();
  await expect(card.getByText('Please check one of the boxes below:')).toBeVisible();
  await expect(
    card.getByText('No, I do not have a disability and have not had one in the past'),
  ).toBeVisible();
  // While the one answer stands, the form holds the other boxes shut: they stay the question's choices.
  await expect(page.locator('#d1-disabilityStatus')).toBeDisabled();

  // Filled again, nothing is unticked or dated anew.
  await again();
  await expect.poll(sent).toEqual(filled);
  await expect(page.locator('#errors')).toHaveText('');
  await expect(card.getByText('Filled 4/4 required')).toBeVisible();

  // An answer the owner changes by hand is theirs: it stays.
  await page.locator('#d2-disabilityStatus').click();
  await page.locator('#d3-disabilityStatus').click();
  await expect.poll(sent).toMatchObject({ disabilityStatus: { id: 'd3' } });
  await again();
  await expect.poll(sent).toEqual({ ...filled, disabilityStatus: { id: 'd3' } });
});

test('moves its own tick in a Workday group when the profile’s answer changes', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  outbox.profiles.push(applicant({ race: 'asian', disability: 'no' }));
  await serveWorkday(context);
  const page = await context.newPage();
  await page.goto(APPLY);
  const card = page.locator('outbox-autofill');
  const sent = async () => JSON.parse((await page.locator('#sent').textContent()) ?? '{}') as unknown;

  await card.getByRole('button', { name: /^Fill/ }).click({ timeout: 15_000 });
  await expect(card.getByText('Filled 4/4 required')).toBeVisible({ timeout: 45_000 });
  await expect.poll(sent).toMatchObject({ ethnicityMulti: [{ id: 'a2' }], disabilityStatus: { id: 'd2' } });

  // The new answer's box stands before the old one's, shut while that one is ticked: the old tick goes first.
  outbox.profiles.push(applicant({ race: 'white', disability: 'yes' }));
  await card.getByRole('button', { name: 'Fill again' }).click();
  await expect.poll(sent, { timeout: 45_000 }).toMatchObject({
    ethnicityMulti: [{ id: 'a7' }],
    disabilityStatus: { id: 'd1' },
  });
  await expect(page.locator('#d1-disabilityStatus')).toBeChecked();
  await expect(page.locator('#d2-disabilityStatus')).not.toBeChecked();
});

test('attaches the resume on Workday’s My Experience once, and a fill report keeps nothing of the file', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serveWorkday(context);
  const page = await context.newPage();
  await page.goto(`${APPLY}?step=experience`);
  const card = page.locator('outbox-autofill');
  // What the form holds, as it would send it.
  const sent = async () => JSON.parse((await page.locator('#sent').textContent()) ?? '{}') as unknown;
  const reports = () =>
    worker.evaluate(async () => {
      const { chrome } = globalThis as unknown as {
        chrome: {
          storage: { local: { get(key: string): Promise<{ snapshots?: { id: string; html: string }[] }> } };
        };
      };
      return (await chrome.storage.local.get('snapshots')).snapshots ?? [];
    });
  // "This page didn't fill right", from the card's menu: pressed again on the same form, it replaces the last.
  const report = async () => {
    const last = (await reports())[0]?.id;
    await card.getByRole('button', { name: 'More' }).click();
    await card.getByRole('menuitem', { name: /fill right/ }).click();
    await expect.poll(async () => (await reports())[0]?.id, { timeout: 15_000 }).not.toBe(last);
    return (await reports())[0]!.html;
  };

  await expect(card.getByRole('button', { name: /^Fill/ })).toBeVisible({ timeout: 15_000 });
  const unanswered = await report();

  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45_000 });
  const one = { resumeAttachments: [{ id: 'Alex_Chen_Resume.pdf' }] };
  await expect.poll(sent).toEqual(one);
  // The page empties its input once it has the file, and names the file beside its box: that's what's read.
  await expect(card.getByTitle('Resume/CV', { exact: true })).toContainText('Alex_Chen_Resume.pdf');

  // Filled again, the resume isn't sent a second time.
  await card.getByRole('button', { name: 'Fill again' }).click();
  const bar = card.getByRole('progressbar', { name: /^(Reading the page|Filling)$/ });
  await expect(bar).toBeVisible();
  await expect(bar).toBeHidden({ timeout: 45_000 });
  await page.waitForTimeout(300);
  expect(await sent()).toEqual(one);
  await expect(card.getByTitle('Resume/CV', { exact: true })).toContainText('Alex_Chen_Resume.pdf');

  // The page as reported reads as it did before the file came: no name, size, state or button to delete it.
  const answered = await report();
  expect(answered).not.toContain('Alex_Chen_Resume');
  expect(answered).toBe(unanswered);
});
