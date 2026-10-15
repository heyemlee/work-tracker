import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'dotenv';
import { describe, expect, it, vi } from 'vitest';
import { createSettings, settingsInput } from '../src/resume/settings.js';
const input = {
  provider: 'openai' as const,
  model: 'gpt-5.4-mini',
  apiKey: 'fake-key-for-tests-only',
  enabled: true,
};
async function sandbox(work: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'outbox-model-settings-'));
  try {
    await work(join(dir, '.env'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
describe('local model settings', () => {
  it('saves privately, does not expose the key, preserves unrelated settings and applies without restart', async () =>
    sandbox(async (path) => {
      await writeFile(
        path,
        '# Local database\nDATABASE_URL=postgresql://keep-me\nRESUME_MODEL=old\nRESUME_MODEL=duplicate\n',
      );
      const env: NodeJS.ProcessEnv = {},
        fetcher = vi.fn<typeof fetch>(),
        settings = createSettings(path, env, fetcher);
      const status = await settings.save(input);
      expect(status).toMatchObject({
        provider: 'openai',
        enabled: true,
        hasKey: true,
        model: input.model,
        configuredProviders: { openai: true, anthropic: false },
      });
      expect(JSON.stringify(status)).not.toContain(input.apiKey);
      expect(fetcher).not.toHaveBeenCalled();
      const contents = await readFile(path, 'utf8');
      expect(parse(contents)).toMatchObject({
        DATABASE_URL: 'postgresql://keep-me',
        RESUME_PROVIDER: 'openai',
        OPENAI_API_KEY: input.apiKey,
        ENABLE_RESUME_AI: 'true',
      });
      expect(contents.match(/^RESUME_MODEL=/gm)).toHaveLength(1);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(settings.config()).toMatchObject({ key: input.apiKey, provider: 'openai' });
      await settings.save({ provider: input.provider, model: input.model, enabled: false });
      expect(env.OPENAI_API_KEY).toBe(input.apiKey);
      expect(settings.config()).toBeNull();
    }));
  it('requires a key and rejects newline injection or unknown combinations', async () =>
    sandbox(async (path) => {
      const settings = createSettings(path, {});
      await expect(
        settings.save({ provider: input.provider, model: input.model, enabled: true }),
      ).rejects.toThrow('API Key');
      expect(settingsInput.safeParse({ ...input, apiKey: 'fake-key\nOTHER=value' }).success).toBe(false);
      expect(settingsInput.safeParse({ ...input, provider: 'anthropic' }).success).toBe(false);
    }));
  it('removes the selected key without removing the other provider key', async () =>
    sandbox(async (path) => {
      const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'other-fake-key' },
        settings = createSettings(path, env);
      await settings.save(input);
      const status = await settings.remove('openai');
      expect(status.enabled).toBe(false);
      expect(status.configuredProviders).toEqual({ openai: false, anthropic: true });
      expect(env.ANTHROPIC_API_KEY).toBe('other-fake-key');
      expect(parse(await readFile(path, 'utf8')).OPENAI_API_KEY).toBe('');
    }));
  it('checks only the fixed model endpoint without sending resume data', async () =>
    sandbox(async (path) => {
      const fetcher = vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(JSON.stringify({ id: input.model }))),
        settings = createSettings(path, {}, fetcher);
      await settings.save(input);
      expect((await settings.check()).ok).toBe(true);
      expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/models/gpt-5.4-mini');
      expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error' });
      expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
    }));
  it('never forwards secret-bearing upstream error bodies', async () =>
    sandbox(async (path) => {
      const fetcher = vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response('secret response text', { status: 403 })),
        settings = createSettings(path, {}, fetcher);
      await settings.save(input);
      await expect(settings.check()).rejects.toThrow('403');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }));
});
