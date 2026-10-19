import { expect, type BrowserContext } from '@playwright/test';
import { pressable, seed, test } from './harness';

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
  await pressable(settings);
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

test('draws its settings in a frame of Outbox’s own window: one section, in Outbox’s language', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  // No language chosen in the extension: it follows Outbox's.
  await worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as {
      chrome: {
        storage: {
          local: { get(key: string): Promise<Record<string, object>>; set(items: object): Promise<void> };
        };
      };
    };
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, language: 'auto' } });
  });
  const { page, replies, ask } = await openOutbox(context);
  await expect.poll(replies).toContainEqual(expect.objectContaining({ type: 'hello' }));
  await ask({ type: 'ping', locale: 'zh' });

  await ask({ type: 'settings-frame', id: 'f1', section: 'ai', dark: false });
  const answer = async () => (await replies()).find((reply) => reply.type === 'settings-frame');
  await expect.poll(answer).toMatchObject({
    id: 'f1',
    url: expect.stringMatching(/^chrome-extension:\/\/\w+\/options\.html#ticket=/),
  });
  const url = String((await answer())?.url);

  // Outbox's window puts the page in a frame and listens to it.
  await page.evaluate((url) => {
    const said: unknown[] = [];
    Object.assign(window, { said });
    const frame = document.createElement('iframe');
    addEventListener('message', (event) => {
      if (event.source === frame.contentWindow) said.push(event.data);
    });
    frame.src = url;
    frame.style.cssText = 'width: 680px; height: 560px; border: 0';
    document.body.append(frame);
  }, url);
  const said = () => page.evaluate(() => (window as unknown as { said: unknown[] }).said);
  await expect.poll(said).toContainEqual({ source: 'outbox-autofill', type: 'settings-shown' });
  const settings = await pressable(page.frameLocator('iframe'));
  // The section asked for alone, in Chinese: no title and no sections of its own, Outbox's window has those.
  await expect(settings.getByRole('switch', { name: '使用 AI' })).toBeVisible();
  await expect(settings.getByRole('heading')).toHaveCount(0);
  await expect(settings.getByRole('tab')).toHaveCount(0);

  // The window turns it to another section, and to dark.
  const tell = (message: object) =>
    page.evaluate(
      (message) => document.querySelector('iframe')?.contentWindow?.postMessage(message, '*'),
      message,
    );
  await tell({ type: 'settings:section', section: 'general' });
  await expect(settings.getByLabel('同公司提醒')).toBeVisible();
  // Its language is Outbox's, chosen there: none to pick here.
  await expect(settings.getByText('语言', { exact: true })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: '导出扩展数据（JSON）' })).toBeVisible();
  await tell({ type: 'settings:scheme', dark: true });
  await expect(settings.locator('.pane')).toHaveClass(/\bdark\b/);

  // Outbox's language changes, and the page with it.
  await ask({ type: 'ping', locale: 'en' });
  await expect(settings.getByLabel('Same-company warning')).toBeVisible();

  // Escape there asks the window to close; the frame stays until the window takes it away.
  await settings.getByLabel('Same-company warning').click();
  await page.keyboard.press('Escape');
  await expect.poll(said).toContainEqual({ source: 'outbox-autofill', type: 'settings-close' });

  // The ticket was good for one showing: the same address in another frame draws nothing.
  await page.evaluate((url) => {
    const again = document.createElement('iframe');
    again.id = 'again';
    again.src = url + '&again';
    document.body.append(again);
  }, url);
  await expect(
    page.frameLocator('#again').getByText('Open the settings from the Outbox Autofill card.'),
  ).toBeVisible();
});
