import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Snapshot } from '../../src/domain/types';
import { makeProfile } from '../src/test/profiles';

const here = dirname(fileURLToPath(import.meta.url));

export const fixture = (path: string) => readFileSync(resolve(here, '../test/fixtures', path), 'utf8');

/** The resume PDF Outbox holds for its one version. */
const RESUME_PDF = '%PDF-1.4\n% Outbox Autofill test resume\n';

/** What Outbox answers: one account, one resume version with its PDF, nothing applied yet. */
export const SNAPSHOT: Snapshot = {
  accounts: [
    {
      id: 'acc-1',
      label: '',
      email: 'alex@example.com',
      color: 'blue',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  ],
  resumes: [
    {
      id: 'res-1',
      name: 'SDE-v3',
      createdAt: '2026-09-01T00:00:00.000Z',
      file: { name: 'Alex_Chen_Resume.pdf', size: RESUME_PDF.length, uploadedAt: '2026-09-28T12:00:00.000Z' },
    },
  ],
  channels: [],
  companies: [],
  jobs: [],
  applications: [],
};

export interface OutboxMock {
  url: string;
  /** What Outbox answers for its snapshot: `SNAPSHOT`, until a spec puts another in its place. */
  snapshot: Snapshot;
  /** The PDF Outbox holds for each resume version, by the version's id: `res-1`'s, until a spec says otherwise. */
  pdfs: Record<string, string>;
  quickAdds: Record<string, unknown>[];
  /** How long Outbox takes to answer a log, in milliseconds: no time, until a spec says otherwise. */
  logTakes: number;
  /** Profiles saved from the card's own window, oldest first. */
  profiles: Record<string, unknown>[];
}

export const test = base.extend<{
  outbox: OutboxMock;
  build: 'e2e' | 'production';
  context: BrowserContext;
  worker: Worker;
}>({
  // Which build runs. The specs' own (wxt.e2e.config.ts) is the one Chrome loads but for the card's shadow root,
  // left open: Playwright looks into open roots only. `production` is the one Chrome loads, card closed.
  build: ['e2e', { option: true }],

  // eslint-disable-next-line no-empty-pattern
  outbox: async ({}, provide) => {
    const quickAdds: Record<string, unknown>[] = [];
    const profiles: Record<string, unknown>[] = [];
    const mock: OutboxMock = {
      url: '',
      snapshot: SNAPSHOT,
      pdfs: { 'res-1': RESUME_PDF },
      quickAdds,
      logTakes: 0,
      profiles,
    };
    const server = createServer((request, response) => {
      const send = (status: number, body?: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(body === undefined ? '' : JSON.stringify(body));
      };
      if (request.method === 'GET' && request.url === '/api/snapshot') return send(200, mock.snapshot);
      // Resume PDFs live on Outbox; the extension downloads the one it attaches, or shows.
      const pdf = mock.pdfs[/^\/api\/resumes\/([^/]+)\/file$/.exec(request.url ?? '')?.[1] ?? ''];
      if (request.method === 'GET' && pdf !== undefined) {
        response.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': "inline; filename*=UTF-8''Alex_Chen_Resume.pdf",
        });
        return response.end(pdf);
      }
      // The profile lives on Outbox; the extension fetches it before filling.
      if (request.method === 'GET' && request.url === '/api/profile')
        return send(200, {
          saved: { profile: profiles.at(-1) ?? makeProfile(), updatedAt: '2026-09-27T12:00:00.000Z' },
        });
      // The card's own window saves the profile here, as Outbox's profile page does.
      if (request.method === 'PUT' && request.url === '/api/profile') {
        let data = '';
        request.on('data', (chunk) => (data += chunk));
        request.on('end', () => {
          const profile = JSON.parse(data) as Record<string, unknown>;
          profiles.push(profile);
          send(200, { profile, updatedAt: '2026-10-06T12:00:00.000Z' });
        });
        return;
      }
      if (request.method === 'POST' && request.url === '/api/quick-add') {
        let data = '';
        request.on('data', (chunk) => (data += chunk));
        request.on('end', () => {
          quickAdds.push(JSON.parse(data) as Record<string, unknown>);
          setTimeout(
            () =>
              send(200, {
                jobId: 'job-1',
                createdJobId: 'job-1',
                createdCompanyId: 'company-1',
                applicationIds: ['app-1'],
              }),
            mock.logTakes,
          );
        });
        return;
      }
      if (request.method === 'POST' && request.url === '/api/quick-add/undo') return send(204);
      return send(404, { error: 'not found' });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await provide(mock);
    await new Promise<void>((done) => server.close(() => done()));
  },

  context: async ({ build }, provide) => {
    const extension = resolve(here, '..', build === 'e2e' ? '.output/chrome-mv3-e2e' : '.output/chrome-mv3');
    // The specs' own build is made as the run starts (build.ts); the one Chrome loads isn't.
    if (build === 'production' && !existsSync(resolve(extension, 'manifest.json')))
      throw new Error(`No build at ${extension}: run "npm run build -w extension" first.`);
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

/** Puts settings into the extension, as the options page would. The profile and the resume come from Outbox. */
export async function seed(worker: Worker, outboxUrl: string): Promise<void> {
  await worker.evaluate(
    async ({ outboxUrl }) => {
      const { chrome } = globalThis as unknown as {
        chrome: { storage: { local: { set(items: object): Promise<void> } } };
      };
      await chrome.storage.local.set({
        settings: {
          outboxUrl,
          model: 'claude-opus-5-5',
          sameCompanyLimit: 3,
          language: 'en',
          aiEnabled: false,
        },
      });
    },
    { outboxUrl },
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
