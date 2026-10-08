import { expect, type BrowserContext } from '@playwright/test';
import { seed, test } from './harness';

// Outbox's profile page can't reach the extension itself: it asks through the content script on Outbox, which
// hands the request to the service worker, where the API key is.
const PAGE = `<!doctype html><title>Outbox</title><script>
  window.replies = [];
  addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.source === 'outbox-autofill') window.replies.push(event.data);
  });
</script>`;

type Reply = { type: string; [key: string]: unknown };

/** Outbox's page, open and signed out: what the extension answered it so far, and a way to ask it more. */
async function openOutbox(context: BrowserContext) {
  await context.route('https://tracker.haoyang.us/**', (route) => {
    const signedOut = new URL(route.request().url()).pathname.startsWith('/api/');
    return signedOut
      ? route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
      : route.fulfill({ contentType: 'text/html', body: PAGE });
  });
  const page = await context.newPage();
  const replies = () => page.evaluate(() => (window as unknown as { replies: Reply[] }).replies);
  const ask = (message: object) =>
    page.evaluate(
      (message) => window.postMessage({ source: 'outbox-page', ...message }, location.origin),
      message,
    );
  await page.goto('https://tracker.haoyang.us/');
  return { page, replies, ask };
}

test('answers Outbox’s page: whether it can read a resume, and why not', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  const { replies, ask } = await openOutbox(context);

  // The seeded settings have AI turned off.
  await expect
    .poll(replies)
    .toContainEqual(
      expect.objectContaining({ source: 'outbox-autofill', type: 'hello', readiness: 'ai-off' }),
    );

  await worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as {
      chrome: {
        storage: {
          local: { get(key: string): Promise<Record<string, object>>; set(items: object): Promise<void> };
        };
      };
    };
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, aiEnabled: true } });
  });
  await ask({ type: 'ping' });
  await expect
    .poll(replies)
    .toContainEqual(
      expect.objectContaining({ source: 'outbox-autofill', type: 'hello', readiness: 'no-key' }),
    );

  await ask({ type: 'parse-resume', id: 'r1', pdf: 'JVBERi0xLjQK' });
  await expect.poll(replies).toContainEqual({
    source: 'outbox-autofill',
    type: 'parse-error',
    id: 'r1',
    error: 'no-key',
    detail: '',
  });
});

test('shows its settings over Outbox’s page when asked there, not in a tab', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  const { page, replies, ask } = await openOutbox(context);
  const hellos = async () => (await replies()).filter((reply) => reply.type === 'hello');
  // The seeded settings have AI turned off.
  await expect.poll(hellos).toEqual([expect.objectContaining({ readiness: 'ai-off' })]);

  await ask({ type: 'open-options' });
  // The extension's own page in a frame, in a window of its own over Outbox: no tab opens, and no card.
  const settings = page.frameLocator('outbox-autofill iframe');
  await expect(settings.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.locator('outbox-autofill .card')).toHaveCount(0);
  expect(context.pages()).toHaveLength(2);
  // Asked again, it stays the one window.
  await ask({ type: 'open-options' });
  await ask({ type: 'ping' });
  await expect.poll(hellos).toHaveLength(2);
  await expect(page.locator('outbox-autofill')).toHaveCount(1);

  // What's changed there reaches the page as the window closes, without its asking.
  await settings.getByRole('tab', { name: 'AI' }).click();
  await settings.getByRole('switch', { name: 'Use AI' }).click();
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('outbox-autofill')).toHaveCount(0);
  await expect.poll(async () => (await hellos()).at(-1)).toMatchObject({ readiness: 'no-key' });
  expect(context.pages()).toHaveLength(2);

  // Closed, the window opens again. Keys go to it from the start, and Escape closes it.
  await ask({ type: 'open-options' });
  await expect(settings.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.localName)).toBe('outbox-autofill');
  // The key on its way down only: the frame it would come up in is gone by then.
  await page.keyboard.down('Escape');
  await expect(page.locator('outbox-autofill')).toHaveCount(0);
});
