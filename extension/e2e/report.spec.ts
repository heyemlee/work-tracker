import { expect, type Worker } from '@playwright/test';
import { seed, serve, test } from './harness';

// "This page didn't fill right" where the card couldn't read the page's form: the report keeps the page itself, for
// the next build to learn to read it.

const shell = (title: string, head: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;

/** A step of a company's own application that asks only its questions: no name, email or resume to know it by. */
const QUESTIONNAIRE = shell(
  'Platform Engineer - Acme Robotics',
  '<meta property="og:site_name" content="Acme Robotics"><meta property="og:title" content="Platform Engineer">',
  '<main><h1>Platform Engineer</h1><form>' +
    '<p><label for="why">Why Acme Robotics?</label><textarea id="why"></textarea></p>' +
    '<p><label for="start">When could you start?</label><input id="start"></p>' +
    '<p><button type="button">Next</button></p></form></main>',
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

test('keeps the page of a form the card couldn’t read, when the owner reports it', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'careers.acme-robotics.com', QUESTIONNAIRE, QUESTIONNAIRE);
  const page = await context.newPage();
  await page.goto('https://careers.acme-robotics.com/apply/platform-engineer');
  await page.bringToFront();
  await press(worker);

  // The card took the page for a posting's: its form went unread.
  const card = page.locator('outbox-autofill');
  await expect(card.locator('.actions button')).toHaveText(['Mark as applied', 'Save for later'], {
    timeout: 15_000,
  });
  await card.getByRole('button', { name: 'More' }).click();
  await card.getByRole('menuitem', { name: 'This page didn’t fill right' }).click();
  await expect(card.getByText(/^Saved the form’s structure/)).toBeVisible();

  const [report] = await reports(worker);
  expect(report).toMatchObject({
    ats: 'generic',
    url: 'https://careers.acme-robotics.com/apply/platform-engineer',
    fields: [],
  });
  expect(report!.html).toContain('When could you start?');
});
