import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'dotenv';
import { describe, expect, it, vi } from 'vitest';
import { normalizeOpenAiBaseUrl } from '../src/resume/endpoint.js';
import { modelConfig, parseResume } from '../src/resume/model.js';
import { createSettings } from '../src/resume/settings.js';

const apiKey = 'fake-gateway-key-only-for-tests';
const baseUrl = 'https://gateway.example/openai/v1';
const model = 'gpt-5.4-mini';
const list = (id = model) => new Response(JSON.stringify({ object: 'list', data: [{ id }] }));
async function sandbox(work: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'outbox-base-url-'));
  try {
    await work(join(dir, '.env'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
describe('OpenAI API base URL', () => {
  it.each([
    ['', 'https://api.openai.com/v1'],
    ['https://gateway.example/', 'https://gateway.example/v1'],
    ['https://gateway.example/v1/', 'https://gateway.example/v1'],
    ['https://gateway.example/openai/v1///', baseUrl],
    ['http://127.0.0.1:9000/v1/', 'http://127.0.0.1:9000/v1'],
    ['http://[::1]:9000/', 'http://[::1]:9000/v1'],
  ])('normalizes %s without duplicating the API prefix', (input, expected) => {
    expect(normalizeOpenAiBaseUrl(input)).toBe(expected);
  });
  it.each([
    'http://gateway.example/v1',
    'ftp://gateway.example/v1',
    'https://user:password@gateway.example/v1',
    'https://gateway.example/v1?api_key=secret',
    'https://gateway.example/v1#secret',
    'https://gateway.example/v1/responses',
    'https://gateway.example/v1/chat/completions',
    'https://gateway.example/v1/models',
    'https://gateway.example/\npath',
    'https://gateway.example\\other/v1',
  ])('rejects an unsafe or full endpoint URL before any request: %s', (input) => {
    expect(() => normalizeOpenAiBaseUrl(input)).toThrow('Base URL');
  });
  it('uses a custom base for discovery, saves it, and uses it for connection checks and parsing', async () =>
    sandbox(async (path) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(list())
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: model })));
      const settings = createSettings(path, {}, fetcher);
      await settings.listModels({ provider: 'openai', apiKey, baseUrl: `${baseUrl}/` });
      await expect(readFile(path)).rejects.toThrow(); // Discovery does not save settings.
      await settings.save({ provider: 'openai', model, apiKey, baseUrl, enabled: true });
      expect(settings.status().openaiBaseUrl).toBe(baseUrl);
      expect(JSON.stringify(settings.status())).not.toContain(apiKey);
      await settings.check();
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        `${baseUrl}/models`,
        `${baseUrl}/models/${model}`,
      ]);
      const env = parse(await readFile(path, 'utf8'));
      expect(env.OPENAI_BASE_URL).toBe(baseUrl);
      const config = modelConfig(env)!;
      expect(config).toMatchObject({ baseUrl, key: apiKey, provider: 'openai' });
      const facts = JSON.parse(
        await readFile(new URL('../evals/synthetic/gold.json', import.meta.url), 'utf8'),
      );
      for (const method of ['function-calling', 'structured-output'] as const) {
        const output =
          method === 'function-calling'
            ? [{ type: 'function_call', name: 'extract_resume', arguments: JSON.stringify(facts) }]
            : [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(facts) }] }];
        const parseFetcher = vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output })));
        expect((await parseResume('Sample', method, config, parseFetcher)).facts).toEqual(facts);
        expect(parseFetcher.mock.calls[0][0]).toBe(`${baseUrl}/responses`);
        expect(parseFetcher.mock.calls[0][1]).toMatchObject({
          redirect: 'error',
          headers: { Authorization: `Bearer ${apiKey}` },
        });
      }
    }));
  it('never sends or transfers an existing saved key to another address', async () =>
    sandbox(async (path) => {
      const fetcher = vi.fn<typeof fetch>(),
        settings = createSettings(path, { OPENAI_API_KEY: apiKey }, fetcher);
      await expect(settings.listModels({ provider: 'openai', baseUrl })).rejects.toThrow('对应的 API Key');
      await expect(settings.save({ provider: 'openai', model, baseUrl, enabled: true })).rejects.toThrow(
        '对应的 API Key',
      );
      expect(fetcher).not.toHaveBeenCalled();
      await expect(readFile(path)).rejects.toThrow();
      await settings.save({ provider: 'openai', model, baseUrl, apiKey, enabled: true });
      expect(settings.config()).toMatchObject({ baseUrl, key: apiKey });
    }));
  it('does not reuse discovered models at another address with the same key', async () =>
    sandbox(async (path) => {
      const settings = createSettings(
        path,
        {},
        vi.fn<typeof fetch>().mockResolvedValue(list('custom-text-model')),
      );
      await settings.listModels({ provider: 'openai', baseUrl, apiKey });
      await expect(
        settings.save({
          provider: 'openai',
          model: 'custom-text-model',
          apiKey,
          baseUrl: 'https://other.example/v1',
          enabled: true,
        }),
      ).rejects.toThrow('先获取');
      await settings.save({ provider: 'openai', model: 'custom-text-model', apiKey, baseUrl, enabled: true });
      expect(settings.status().openaiBaseUrl).toBe(baseUrl);
    }));
  it('rejects invalid configured addresses rather than silently using the official service', () => {
    expect(
      modelConfig({
        ENABLE_RESUME_AI: 'true',
        RESUME_PROVIDER: 'openai',
        RESUME_MODEL: model,
        OPENAI_API_KEY: apiKey,
        OPENAI_BASE_URL: 'ftp://invalid.example',
      }),
    ).toBeNull();
  });
});
