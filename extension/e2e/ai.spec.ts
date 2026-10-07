import { expect, type Worker } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { seed, serve, test } from './harness';

const THANKS = '<!doctype html><title>Acme</title><main><h1>Thank you for applying.</h1></main>';

// A form that asks one thing in the applicant's own words, and one thing no rule knows.
const FORM = `<!doctype html><html><head><title>Job Application for Software Engineer at Acme</title></head><body>
<form id="application-form">
  <label for="first_name">First Name</label><input id="first_name" type="text" required>
  <label for="last_name">Last Name</label><input id="last_name" type="text" required>
  <label for="email">Email</label><input id="email" type="text" required>
  <label for="why">Why do you want to work at Acme?</label><textarea id="why" required></textarea>
  <label for="office">What is your preferred office location?</label>
  <select id="office" required><option value="">Select...</option><option>Menlo Park, CA</option><option>New York, NY</option></select>
</form></body></html>`;

/**
 * A stand-in for the model: an endpoint speaking OpenAI's chat completions on this machine. Asked for fields, it
 * picks each question's first option; asked for a draft, it numbers it. It counts what it's asked.
 */
async function model() {
  const asked = { fields: 0, drafts: 0 };
  const server = createServer((request, response) => {
    let data = '';
    request.on('data', (chunk) => (data += chunk));
    request.on('end', () => {
      const body = JSON.parse(data) as {
        response_format?: unknown;
        messages: { content: string | { text?: string }[] }[];
      };
      const last = body.messages.at(-1)?.content;
      const prompt = typeof last === 'string' ? last : (last?.at(-1)?.text ?? '');
      let content: string;
      if (body.response_format) {
        asked.fields++;
        const questions = JSON.parse(/<questions>\n([\s\S]*)\n<\/questions>/.exec(prompt)?.[1] ?? '[]') as {
          id: string;
          options?: string[];
        }[];
        content = JSON.stringify({
          answers: questions.map(({ id, options }) => ({
            id,
            answer: options?.[0] ?? '',
            choices: [],
            confidence: 0.95,
            reason: 'the first one offered',
          })),
        });
      } else content = `Draft ${++asked.drafts}.`;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return {
    asked,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** Turns AI on, with the endpoint above as the owner's own. */
async function useModel(worker: Worker, url: string): Promise<void> {
  await worker.evaluate(async (openaiBaseUrl) => {
    const { chrome } = globalThis as unknown as {
      chrome: {
        storage: {
          local: { get(key: string): Promise<Record<string, object>>; set(items: object): Promise<void> };
        };
      };
    };
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({
      settings: { ...settings, aiEnabled: true, provider: 'openai', openaiBaseUrl, openaiModel: 'stand-in' },
      openaiKey: 'sk-test',
    });
  }, url);
}

test('asks AI once: filling again keeps what it wrote, and asks only for what was emptied', async ({
  context,
  worker,
  outbox,
}) => {
  const ai = await model();
  try {
    await seed(worker, outbox.url);
    await useModel(worker, ai.url);
    await serve(context, 'job-boards.greenhouse.io', FORM, THANKS);
    const page = await context.newPage();
    await page.goto('https://job-boards.greenhouse.io/acme/jobs/123');

    const card = page.locator('outbox-autofill');
    const again = async () => {
      await card.getByRole('button', { name: 'Fill again' }).click();
      await expect(card.locator('.progress')).toBeVisible();
      // Through: the count is back, and AI isn't writing.
      await expect(card.getByRole('button', { name: 'Fill again' })).toBeVisible({ timeout: 45_000 });
    };

    await card.getByRole('button', { name: /^Fill/ }).click();
    await expect(page.locator('#why')).toHaveValue('Draft 1.', { timeout: 45_000 });
    await expect(page.locator('#office')).toHaveValue('Menlo Park, CA');
    await expect(card.getByRole('button', { name: 'Fill again' })).toBeVisible();
    expect(ai.asked).toEqual({ fields: 1, drafts: 1 });

    // Filled again: nothing is asked, and what AI wrote stands, still marked as AI's to check.
    await again();
    expect(ai.asked).toEqual({ fields: 1, drafts: 1 });
    await expect(page.locator('#why')).toHaveValue('Draft 1.');
    await expect(page.locator('#office')).toHaveValue('Menlo Park, CA');
    await expect(card.getByTitle('AI: Why do you want to work at Acme?')).toBeVisible();

    // The owner rewrites the draft: theirs, left alone, and no longer AI's to check.
    await page.locator('#why').fill('In my own words.');
    await again();
    expect(ai.asked).toEqual({ fields: 1, drafts: 1 });
    await expect(page.locator('#why')).toHaveValue('In my own words.');
    await expect(card.getByTitle('AI: Why do you want to work at Acme?')).toHaveCount(0);

    // Emptied: that one is asked for again.
    await page.locator('#why').fill('');
    await again();
    await expect(page.locator('#why')).toHaveValue('Draft 2.');
    expect(ai.asked).toEqual({ fields: 1, drafts: 2 });
  } finally {
    await ai.close();
  }
});
