import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import worker from './index';

/** Workers Assets as the deploy has it: built files by name, and the app's page for any other address. */
const ASSETS = {
  fetch: async (input: Request | string) => {
    const { pathname } = new URL(typeof input === 'string' ? input : input.url);
    return pathname === '/assets/index-abc123.js'
      ? new Response('console.log(1)', {
          headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=86400, immutable' },
        })
      : new Response('<!doctype html><title>Outbox</title>', {
          headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=86400, immutable' },
        });
  },
} as unknown as Fetcher;
const env = { ASSETS } as Env;
const ask = (path: string) =>
  worker.fetch(
    new Request(`https://tracker.haoyang.us${path}`) as Parameters<typeof worker.fetch>[0],
    env,
    {} as ExecutionContext,
  );

describe('the built files under /assets', () => {
  // Read where the tests run from, the repository's root.
  it('are reached through the Worker', () => {
    const config = readFileSync('wrangler.jsonc', 'utf8');
    expect(config).toMatch(/"run_worker_first":\s*\[[^\]]*"\/assets\/\*"/);
  });

  it('serves a file the build has, as Workers Assets answers it', async () => {
    const response = await ask('/assets/index-abc123.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript');
  });

  it('answers a name no file has with a 404 kept by no one, not the app’s page', async () => {
    const response = await ask('/assets/index-gone999.js');
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).not.toContain('text/html');
  });
});
