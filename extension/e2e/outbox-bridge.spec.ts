import { expect } from '@playwright/test';
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

test('answers Outbox’s page: whether it can read a resume, and why not', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
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
  // The seeded settings have AI turned off.
  await expect
    .poll(replies)
    .toContainEqual({ source: 'outbox-autofill', type: 'hello', readiness: 'ai-off' });

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
    .toContainEqual({ source: 'outbox-autofill', type: 'hello', readiness: 'no-key' });

  await ask({ type: 'parse-resume', id: 'r1', pdf: 'JVBERi0xLjQK' });
  await expect.poll(replies).toContainEqual({
    source: 'outbox-autofill',
    type: 'parse-error',
    id: 'r1',
    error: 'no-key',
    detail: '',
  });
});
