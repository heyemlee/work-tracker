import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProfile } from '../src/test/profiles';

const here = dirname(fileURLToPath(import.meta.url));

export const fixture = (path: string) => readFileSync(resolve(here, '../test/fixtures', path), 'utf8');

/** What Outbox answers: one account, one resume version, nothing applied yet. */
export const SNAPSHOT = {
  accounts: [
    {
      id: 'acc-1',
      label: '',
      email: 'alex@example.com',
      color: 'blue',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  ],
  resumes: [{ id: 'res-1', name: 'SDE-v3', createdAt: '2026-09-01T00:00:00.000Z' }],
  channels: [],
  companies: [],
  jobs: [],
  applications: [],
};

export interface OutboxMock {
  url: string;
  quickAdds: Record<string, unknown>[];
}

export const test = base.extend<{ outbox: OutboxMock; context: BrowserContext; worker: Worker }>({
  // eslint-disable-next-line no-empty-pattern
  outbox: async ({}, provide) => {
    const quickAdds: Record<string, unknown>[] = [];
    const server = createServer((request, response) => {
      const send = (status: number, body?: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(body === undefined ? '' : JSON.stringify(body));
      };
      if (request.method === 'GET' && request.url === '/api/snapshot') return send(200, SNAPSHOT);
      if (request.method === 'POST' && request.url === '/api/quick-add') {
        let data = '';
        request.on('data', (chunk) => (data += chunk));
        request.on('end', () => {
          quickAdds.push(JSON.parse(data) as Record<string, unknown>);
          send(200, {
            jobId: 'job-1',
            createdJobId: 'job-1',
            createdCompanyId: 'company-1',
            applicationIds: ['app-1'],
          });
        });
        return;
      }
      if (request.method === 'POST' && request.url === '/api/quick-add/undo') return send(204);
      return send(404, { error: 'not found' });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    await provide({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, quickAdds });
    await new Promise<void>((done) => server.close(() => done()));
  },

  // eslint-disable-next-line no-empty-pattern
  context: async ({}, provide) => {
    const extension = resolve(here, '../.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    await provide(context);
    await context.close();
  },

  worker: async ({ context }, provide) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await provide(worker);
  },
});

/** Puts a profile, settings and a resume PDF into the extension, as the options page would. */
export async function seed(worker: Worker, outboxUrl: string): Promise<void> {
  const profile = makeProfile();
  await worker.evaluate(
    async ({ profile, outboxUrl }) => {
      const pdf = '%PDF-1.4\n% Outbox Autofill test resume\n';
      const { chrome } = globalThis as unknown as {
        chrome: { storage: { local: { set(items: object): Promise<void> } } };
      };
      await chrome.storage.local.set({
        profile,
        settings: {
          outboxUrl,
          model: 'claude-opus-5',
          sameCompanyLimit: 3,
          language: 'en',
          aiEnabled: false,
        },
        resumes: [
          {
            id: 'resume-1',
            fileName: 'Alex_Chen_Resume.pdf',
            size: pdf.length,
            outboxResumeId: 'res-1',
            label: 'SDE-v3',
            addedAt: new Date().toISOString(),
          },
        ],
      });
      const db = await new Promise<IDBDatabase>((done, fail) => {
        const request = indexedDB.open('outbox-autofill', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('resumes');
        request.onsuccess = () => done(request.result);
        request.onerror = () => fail(request.error);
      });
      await new Promise<void>((done, fail) => {
        const transaction = db.transaction('resumes', 'readwrite');
        transaction.objectStore('resumes').put(new Blob([pdf], { type: 'application/pdf' }), 'resume-1');
        transaction.oncomplete = () => done();
        transaction.onerror = () => fail(transaction.error);
      });
      db.close();
    },
    { profile, outboxUrl },
  );
}

/** Serves a saved page for every request to a host; form submissions (a query string) get `confirmation`. */
export async function serve(
  context: BrowserContext,
  host: string,
  page: string,
  confirmation: string,
): Promise<void> {
  await context.route(`https://${host}/**`, (route) => {
    // A GET form with unnamed React inputs submits to "…/jobs/123?", whose URL.search is empty.
    const url = route.request().url();
    const submitted = url.includes('?') || new URL(url).pathname.endsWith('/thanks');
    return route.fulfill({ contentType: 'text/html', body: submitted ? confirmation : page });
  });
  // The saved pages link the job board's own scripts and styles; none are needed.
  await context.route(/job-boards\.cdn\.greenhouse\.io|fonts\.googleapis\.com|fonts\.gstatic\.com/, (route) =>
    route.fulfill({ body: '' }),
  );
}
