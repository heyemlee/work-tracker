import { expect, type Worker } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { seed, serve, test } from './harness';

const THANKS = '<!doctype html><title>Thanks</title><main><h1>Thank you for applying.</h1></main>';
const FORM =
  '<!doctype html><title>Robotics Engineer</title><main><h1>Robotics Engineer</h1><form>' +
  '<label for="first">First name</label><input id="first" name="first_name">' +
  '<label for="email">Email</label><input id="email" name="email" type="email">' +
  '<label for="resume">Resume/CV</label><input id="resume" name="resume" type="file">' +
  '<button type="submit">Submit application</button></form></main>';

type Local = { get(key: string): Promise<Record<string, unknown>>; set(items: object): Promise<void> };
type Extension = { chrome: { storage: { local: Local } } };

/** A page that was marked "This page didn't fill right", as the card saves it. */
const REPORT = {
  id: 'report-1',
  at: '2026-10-06T18:00:00.000Z',
  ats: 'greenhouse',
  url: 'https://job-boards.greenhouse.io/embed/job_app',
  company: 'Acme',
  title: 'Software Engineer',
  step: null,
  html: '',
  fields: [
    {
      label: 'School',
      kind: 'typeahead',
      options: [],
      required: true,
      hint: null,
      section: '',
      status: 'missing',
      key: null,
    },
    {
      label: 'First Name',
      kind: 'text',
      options: [],
      required: true,
      hint: null,
      section: '',
      status: 'filled',
      key: null,
    },
  ],
};

/** What the extension keeps under a key, read where it keeps it. */
const stored = (worker: Worker, key: string) =>
  worker.evaluate(
    async (name) => (await (globalThis as unknown as Extension).chrome.storage.local.get(name))[name],
    key,
  );

test('shows the settings in a window over the page, and what’s changed there holds', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await worker.evaluate(
    (report) => (globalThis as unknown as Extension).chrome.storage.local.set({ snapshots: [report] }),
    REPORT,
  );
  await serve(context, 'careers.acme-robotics.com', FORM, THANKS);
  const page = await context.newPage();
  await page.goto('https://careers.acme-robotics.com/jobs/42/apply');

  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: 'More' }).click({ timeout: 15_000 });
  await card.getByRole('menuitem', { name: 'Settings' }).click();
  // No tab opens: the settings are the extension's own page, in a frame inside the card's window.
  const settings = page.frameLocator('outbox-autofill iframe');
  await expect(settings.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(settings.getByText('Connected · 1 account')).toBeVisible();
  expect(context.pages()).toHaveLength(2);
  // Even a page that got hold of the frame couldn't look into it. (This build leaves the card's root open, for
  // Playwright; in the one Chrome loads the page can't find the frame either: reach.spec.ts.)
  expect(
    await page.evaluate(() => {
      const frame = document.querySelector('outbox-autofill')?.shadowRoot?.querySelector('iframe');
      return frame ? frame.contentDocument === null : null;
    }),
  ).toBe(true);

  // The pages marked "This page didn't fill right" are listed, and one can be taken off the list.
  await settings.getByRole('tab', { name: 'Fill reports' }).click();
  await expect(settings.getByText('Acme · Software Engineer')).toBeVisible();
  await expect(settings.getByText(/Greenhouse · 2 fields · 1 not filled/)).toBeVisible();
  await settings.getByRole('button', { name: 'Delete' }).click();
  await expect(settings.getByText('No reports.')).toBeVisible();
  expect(await stored(worker, 'snapshots')).toEqual([]);

  // A setting holds as soon as it's changed, and the card takes it up when the window closes.
  await settings.getByRole('tab', { name: 'General' }).click();
  await settings.getByLabel('Language').selectOption('zh');
  await expect(settings.getByRole('tab', { name: '通用' })).toBeVisible();
  expect(await stored(worker, 'settings')).toMatchObject({ language: 'zh' });
  await settings.getByRole('tab', { name: '通用' }).press('Escape');
  await expect(card.locator('iframe')).toHaveCount(0);
  await expect(card.getByRole('button', { name: '填写', exact: true })).toBeVisible();
});

test('offers the models the owner settled on, and how hard they think', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await worker.evaluate(async () => {
    const { local } = (globalThis as unknown as Extension).chrome.storage;
    const { settings } = (await local.get('settings')) as { settings: object };
    await local.set({ settings: { ...settings, aiEnabled: true, provider: 'openai' } });
  });
  await serve(context, 'careers.acme-robotics.com', FORM, THANKS);
  const page = await context.newPage();
  await page.goto('https://careers.acme-robotics.com/jobs/42/apply');
  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: 'More' }).click({ timeout: 15_000 });
  await card.getByRole('menuitem', { name: 'Settings' }).click();
  const settings = page.frameLocator('outbox-autofill iframe');
  await settings.getByRole('tab', { name: 'AI' }).click();

  // Three models to pick from, not everything the endpoint lists.
  const model = settings.getByLabel('Model');
  await expect(model.locator('option')).toHaveText(['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra']);
  await expect(model).toHaveValue('gpt-5.6-terra');
  await model.selectOption('gpt-5.6-sol');
  const effort = settings.getByLabel('Reasoning effort');
  await expect(effort).toHaveValue('auto');
  await effort.selectOption('high');
  await expect
    .poll(() => stored(worker, 'settings'))
    .toMatchObject({ openaiModel: 'gpt-5.6-sol', openaiEffort: 'high' });
});

/** A stand-in for an OpenAI-compatible endpoint that knows one key: asked with it, it says OK; with another, 401. */
async function endpoint(known: string) {
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      const letIn = request.headers.authorization === `Bearer ${known}`;
      response.writeHead(letIn ? 200 : 401, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(
          letIn
            ? {
                choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1 },
              }
            : { error: { message: 'Incorrect API key provided' } },
        ),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

test('says how to save what’s typed, then that it’s saved, and of a key the whole time', async ({
  context,
  worker,
  outbox,
}) => {
  const api = await endpoint('sk-good-key-7777');
  try {
    await seed(worker, outbox.url);
    await worker.evaluate(async () => {
      const { local } = (globalThis as unknown as Extension).chrome.storage;
      const { settings } = (await local.get('settings')) as { settings: object };
      await local.set({ settings: { ...settings, aiEnabled: true, provider: 'openai' } });
    });
    await serve(context, 'careers.acme-robotics.com', FORM, THANKS);
    const page = await context.newPage();
    await page.goto('https://careers.acme-robotics.com/jobs/42/apply');
    const card = page.locator('outbox-autofill');
    await card.getByRole('button', { name: 'More' }).click({ timeout: 15_000 });
    await card.getByRole('menuitem', { name: 'Settings' }).click();
    const settings = page.frameLocator('outbox-autofill iframe');
    await settings.getByRole('tab', { name: 'AI' }).click();
    const said = (field: string) => settings.locator('label.field', { hasText: field }).locator('.saved');

    // An address: nothing is kept while it's typed, and the field says what keeps it.
    const address = settings.getByLabel('Address');
    await address.fill(`${api.url}/`);
    await expect(said('Address')).toHaveText('Press Enter to save');
    expect(await stored(worker, 'settings')).not.toMatchObject({ openaiBaseUrl: `${api.url}/` });
    await address.press('Enter');
    await expect(said('Address')).toHaveText('Saved');
    expect(await stored(worker, 'settings')).toMatchObject({ openaiBaseUrl: `${api.url}/` });
    // Said for a moment, not for good: the address is there to read.
    await expect(said('Address')).toHaveCount(0);

    // A key: kept when the field is left, though nothing was pressed. It can't be read back, so its label goes on
    // saying that one is kept.
    const key = settings.getByLabel('API key');
    await expect(said('API key')).toHaveCount(0);
    await key.fill('sk-wrong-key-1234');
    await expect(said('API key')).toHaveText('Press Enter to save');
    await expect(settings.getByRole('button', { name: 'Save' })).toBeVisible();
    await settings.getByText('This month').click();
    await expect(said('API key')).toHaveText('Saved');
    expect(await stored(worker, 'openaiKey')).toBe('sk-wrong-key-1234');
    await expect(key).toHaveValue('');
    await expect(key).toHaveAttribute('placeholder', '••••1234');
    await page.waitForTimeout(3000);
    await expect(said('API key')).toHaveText('Saved');

    // Tried, it isn't let in: the key stays kept all the same, and the line says which of the two failed.
    await settings.getByRole('button', { name: 'Check' }).click();
    await expect(
      settings.getByText(/^The saved key didn’t pass the check: the provider doesn’t recognize it \(401\)/),
    ).toBeVisible();
    expect(await stored(worker, 'openaiKey')).toBe('sk-wrong-key-1234');

    // Another typed over it, and the button pressed: saved and tried in one go. The verdict of the last one goes.
    await key.fill('sk-good-key-7777');
    await settings.getByRole('button', { name: 'Save' }).click();
    await expect(settings.getByText('The key works.')).toBeVisible();
    await expect(settings.getByText(/didn’t pass the check/)).toHaveCount(0);
    expect(await stored(worker, 'openaiKey')).toBe('sk-good-key-7777');
    await expect(key).toHaveAttribute('placeholder', '••••7777');

    // A choice says it too.
    await settings.getByLabel('Model').selectOption('gpt-5.6-sol');
    await expect(said('Model')).toHaveText('Saved');
    await expect(settings.getByText('The key works.')).toHaveCount(0);
  } finally {
    await api.close();
  }
});

test('offers Anthropic’s current models, and asks the one chosen as that model is asked', async ({
  context,
  worker,
  outbox,
}) => {
  // Anthropic, stood in for: what it's sent is kept, and every key is let in.
  const sent: { beta: string | undefined; body: Record<string, unknown> }[] = [];
  await context.route('https://api.anthropic.com/**', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.push({ beta: route.request().headers()['anthropic-beta'], body });
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: 'OK' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 3 },
      }),
    });
  });
  await seed(worker, outbox.url);
  await worker.evaluate(async () => {
    const { local } = (globalThis as unknown as Extension).chrome.storage;
    const { settings } = (await local.get('settings')) as { settings: object };
    // As the settings saved it while Sonnet 5 was the one on offer.
    await local.set({
      settings: { ...settings, aiEnabled: true, provider: 'anthropic', model: 'claude-sonnet-5' },
      anthropicKey: 'sk-ant-test-1234',
    });
  });
  await serve(context, 'careers.acme-robotics.com', FORM, THANKS);
  const page = await context.newPage();
  await page.goto('https://careers.acme-robotics.com/jobs/42/apply');
  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: 'More' }).click({ timeout: 15_000 });
  await card.getByRole('menuitem', { name: 'Settings' }).click();
  const settings = page.frameLocator('outbox-autofill iframe');
  await settings.getByRole('tab', { name: 'AI' }).click();

  // The four on Anthropic's own list, and the older choice moved to the one that took its place.
  const model = settings.getByLabel('Model');
  await expect(model.locator('option')).toHaveText([
    'Claude Fable 5.1',
    'Claude Opus 5.5',
    'Claude Sonnet 5.5',
    'Claude Haiku 5.5',
  ]);
  await expect(model).toHaveValue('claude-sonnet-5-5');
  const check = async () => {
    await settings.getByRole('button', { name: 'Check' }).click();
    await expect(settings.getByText('The key works.')).toBeVisible();
    return sent.at(-1);
  };
  // A request it declines is run again on another model, on Anthropic's side.
  expect(await check()).toMatchObject({
    beta: 'server-side-fallback-2026-07-01',
    body: { model: 'claude-sonnet-5-5', fallbacks: 'default', output_config: { effort: 'low' } },
  });

  // Haiku 5.5 has no such fallback, and isn't asked for one.
  await model.selectOption('claude-haiku-5-5');
  await expect.poll(() => stored(worker, 'settings')).toMatchObject({ model: 'claude-haiku-5-5' });
  await expect(settings.getByText('The key works.')).toHaveCount(0);
  const asked = await check();
  expect(asked?.body).toMatchObject({ model: 'claude-haiku-5-5' });
  expect(asked?.body).not.toHaveProperty('fallbacks');
  expect(asked?.beta).toBeUndefined();
});

test('deletes what the extension keeps in this browser, asked twice', async ({ context, worker, outbox }) => {
  await seed(worker, outbox.url);
  await worker.evaluate(
    (report) =>
      (globalThis as unknown as Extension).chrome.storage.local.set({
        snapshots: [report],
        openaiKey: 'sk-test-1234',
        memory: [
          {
            key: 'k',
            label: 'What type of role are you interested in?',
            answer: { type: 'text', text: 'Backend' },
            uses: 1,
            updatedAt: '2026-10-06T00:00:00.000Z',
          },
        ],
      }),
    REPORT,
  );
  await serve(context, 'careers.acme-robotics.com', FORM, THANKS);
  const page = await context.newPage();
  await page.goto('https://careers.acme-robotics.com/jobs/42/apply');
  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: 'More' }).click({ timeout: 15_000 });
  await card.getByRole('menuitem', { name: 'Settings' }).click();
  const settings = page.frameLocator('outbox-autofill iframe');

  await settings.getByRole('tab', { name: 'Remembered answers' }).click();
  await expect(settings.getByText('What type of role are you interested in?')).toBeVisible();
  await expect(settings.getByText('Backend', { exact: true })).toBeVisible();

  await settings.getByRole('tab', { name: 'General' }).click();
  await settings.getByRole('button', { name: 'Delete everything' }).click();
  // Nothing goes on the first press.
  expect(await stored(worker, 'memory')).toHaveLength(1);
  await settings.getByRole('alert').getByRole('button', { name: 'Cancel' }).click();
  await expect(settings.getByRole('alert')).toHaveCount(0);
  await settings.getByRole('button', { name: 'Delete everything' }).click();
  await settings.getByRole('alert').getByRole('button', { name: 'Delete everything' }).click();
  await expect(settings.getByRole('alert')).toHaveCount(0);
  expect(await stored(worker, 'memory')).toBeUndefined();
  expect(await stored(worker, 'snapshots')).toBeUndefined();
  expect(await stored(worker, 'openaiKey')).toBeUndefined();
  // The settings themselves stay: where Outbox is, which language.
  expect(await stored(worker, 'settings')).toMatchObject({ outboxUrl: outbox.url });
});

test('closes the settings from their own ✕, or by a press on the page behind them', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, 'careers.acme-robotics.com', FORM, THANKS);
  const page = await context.newPage();
  await page.goto('https://careers.acme-robotics.com/jobs/42/apply');
  const card = page.locator('outbox-autofill');
  const settings = page.frameLocator('outbox-autofill iframe');
  const open = async () => {
    await card.getByRole('button', { name: 'More' }).click({ timeout: 15_000 });
    await card.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(settings.getByRole('heading', { name: 'Settings' })).toBeVisible();
  };

  await open();
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(card.locator('iframe')).toHaveCount(0);

  await open();
  await page.mouse.click(20, 400);
  await expect(card.locator('iframe')).toHaveCount(0);
});

test('draws the settings for the card alone, not for a page that frames them itself', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  const address = `chrome-extension://${new URL(worker.url()).host}/options.html`;
  await serve(
    context,
    'careers.acme-robotics.com',
    `<!doctype html><title>Robotics</title><h1>Robotics</h1><iframe src="${address}" style="width:900px;height:600px"></iframe>`,
    THANKS,
  );
  const page = await context.newPage();
  await page.goto('https://careers.acme-robotics.com/');
  const framed = page.frameLocator('iframe');
  await expect(framed.getByText('Open the settings from the Outbox Autofill card.')).toBeVisible();
  await expect(framed.getByRole('tab')).toHaveCount(0);

  // In a tab of their own they're whole, as from the browser's own "Options".
  const tab = await context.newPage();
  await tab.goto(address);
  await expect(tab.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(tab.getByRole('tab', { name: 'Fill reports' })).toBeVisible();
  await expect(tab.getByRole('button', { name: 'Close' })).toHaveCount(0);
});
