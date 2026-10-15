import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createSettings } from '../src/resume/settings.js';
import { modelPolicy, quoteRequest, withBudget } from '../src/resume/budget.js';
const key = 'fake-key-list-test-never-real';
async function sandbox(work: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'outbox-model-list-'));
  try {
    await work(join(dir, '.env'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const list = (ids: string[]) =>
  new Response(
    JSON.stringify({ object: 'list', data: ids.map((id) => ({ id, object: 'model', owned_by: 'fixture' })) }),
  );
describe('account model discovery', () => {
  it('uses an unsaved key without persisting it, deduplicates IDs and labels suitability', async () =>
    sandbox(async (path) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          list(['future-text-model', 'gpt-6.1-sol', 'gpt-6.1-sol', 'text-embedding-3-small']),
        );
      const result = await createSettings(path, {}, fetcher).listModels({ provider: 'openai', apiKey: key });
      expect(result.models.map((m) => m.model)).toEqual([
        'future-text-model',
        'gpt-6.1-sol',
        'text-embedding-3-small',
      ]);
      expect(result.models.find((m) => m.model === 'gpt-6.1-sol')).toMatchObject({
        canParse: true,
        selectable: true,
      });
      expect(result.models.find((m) => m.model === 'future-text-model')).toMatchObject({
        canParse: false,
        selectable: true,
      });
      expect(result.models.find((m) => m.model === 'text-embedding-3-small')).toMatchObject({
        canParse: false,
        selectable: false,
      });
      expect(JSON.stringify(result)).not.toContain(key);
      expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
      expect(fetcher.mock.calls[0][1]).toMatchObject({
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: `Bearer ${key}` },
      });
      expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
      await expect(readFile(path)).rejects.toThrow();
    }));
  it('uses a saved key and saves an unknown fetched model with parsing paused', async () =>
    sandbox(async (path) => {
      const settings = createSettings(
        path,
        { OPENAI_API_KEY: key },
        vi.fn<typeof fetch>().mockResolvedValue(list(['future-text-model'])),
      );
      await settings.listModels({ provider: 'openai' });
      const status = await settings.save({ provider: 'openai', model: 'future-text-model', enabled: true });
      expect(status.model).toBe('future-text-model');
      expect(status.modelPolicy.canParse).toBe(false);
      expect(() => quoteRequest('Resume', 'function-calling', 'future-text-model', 'openai')).toThrow(
        'verified',
      );
      const restored = createSettings(path, {
        OPENAI_API_KEY: key,
        RESUME_PROVIDER: 'openai',
        RESUME_MODEL: 'future-text-model',
      });
      expect(
        (await restored.save({ provider: 'openai', model: 'future-text-model', enabled: false })).model,
      ).toBe('future-text-model');
    }));
  it('does not reuse the discovered catalog with another key', async () =>
    sandbox(async (path) => {
      const settings = createSettings(
        path,
        {},
        vi.fn<typeof fetch>().mockResolvedValue(list(['future-text-model'])),
      );
      await settings.listModels({ provider: 'openai', apiKey: key });
      await expect(
        settings.save({
          provider: 'openai',
          model: 'future-text-model',
          apiKey: 'different-fake-key',
          enabled: true,
        }),
      ).rejects.toThrow('先获取');
    }));
  it.each([401, 403, 429, 500])('does not retry or forward upstream body for status %s', async (code) =>
    sandbox(async (path) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('secret upstream text', { status: code }));
      await expect(
        createSettings(path, {}, fetcher).listModels({ provider: 'openai', apiKey: key }),
      ).rejects.toThrow(String(code));
      expect(fetcher).toHaveBeenCalledTimes(1);
    }),
  );
  it('handles missing keys, empty lists and malformed responses without saving', async () =>
    sandbox(async (path) => {
      await expect(createSettings(path, {}).listModels({ provider: 'openai' })).rejects.toThrow('API Key');
      expect(
        (
          await createSettings(path, {}, vi.fn().mockResolvedValue(list([]))).listModels({
            provider: 'openai',
            apiKey: key,
          })
        ).models,
      ).toEqual([]);
      await expect(
        createSettings(path, {}, vi.fn().mockResolvedValue(new Response('{broken'))).listModels({
          provider: 'openai',
          apiKey: key,
        }),
      ).rejects.toThrow('格式');
    }));
  it('does not infer custom fine-tuned model modality from its suffix', () => {
    expect(modelPolicy('openai', 'ft:gpt-4.1:org:resume-image:abc')).toMatchObject({
      canParse: false,
      selectable: true,
    });
  });
  it('reserves and records long-context rates for reviewed models', async () =>
    sandbox(async (path) => {
      const quote = quoteRequest('长'.repeat(59000), 'function-calling', 'gpt-6.1-sol', 'openai');
      expect(quote.reservedInputTokens).toBeGreaterThan(272000);
      expect(quote.reservedMicrousd).toBe(Math.ceil(quote.reservedInputTokens * 4 + 8192 * 15));
      await withBudget(path, 5, async (b) => {
        const id = await b.reserve('long', quote);
        await b.recordUsage(id, { input_tokens: 280000, output_tokens: 100 });
        expect(b.summary().actualKnownUsd).toBe(1.1215);
      });
    }));
});
