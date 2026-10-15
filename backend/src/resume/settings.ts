import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { aiProviderSchema, modelConfig, type AiProvider } from './model.js';
import { MODEL_CHOICES, modelPolicy } from './budget.js';
import {
  DEFAULT_OPENAI_BASE_URL,
  normalizeOpenAiBaseUrl,
  openAiBaseUrlSchema,
  openAiEndpoint,
} from './endpoint.js';

const ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));
export const settingsInput = z
  .strictObject({
    provider: aiProviderSchema,
    model: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
    apiKey: z
      .string()
      .trim()
      .min(10)
      .max(512)
      .regex(/^[\x21-\x7e]+$/)
      .optional(),
    enabled: z.boolean(),
    baseUrl: openAiBaseUrlSchema.optional(),
  })
  .refine(
    (value) =>
      value.provider === 'openai' ||
      MODEL_CHOICES.some((item) => item.provider === value.provider && item.model === value.model),
    '请选择支持的模型。',
  );
export const modelListInput = z.strictObject({
  provider: z.literal('openai'),
  apiKey: settingsInput.shape.apiKey,
  baseUrl: openAiBaseUrlSchema.optional(),
});
export const removeKeyInput = z.strictObject({ provider: aiProviderSchema });
const keyName = (provider: AiProvider) => (provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY');

/** Local-only settings. Never return secrets; .env remains the shared source for the web service and eval CLI. */
export function createSettings(
  path = ENV_FILE,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
) {
  let saving = false;
  const catalogs = new Map<string, Set<string>>();
  const fingerprint = (key: string, baseUrl: string) =>
    createHash('sha256')
      .update(JSON.stringify([baseUrl, key]))
      .digest('hex');
  const savedBaseUrl = () => normalizeOpenAiBaseUrl(env.OPENAI_BASE_URL);
  const candidateBaseUrl = (baseUrl?: string) => normalizeOpenAiBaseUrl(baseUrl ?? env.OPENAI_BASE_URL);
  function candidateOpenAiKey(apiKey: string | undefined, baseUrl: string) {
    if (!apiKey && baseUrl !== savedBaseUrl() && env.OPENAI_API_KEY?.trim())
      throw new Error('Base URL 已更改，请填写该地址对应的 API Key；不会将原密钥发送到新地址。');
    return apiKey || env.OPENAI_API_KEY?.trim();
  }
  async function persist(patch: Record<string, string>) {
    if (saving) throw new Error('配置正在保存，请稍后再试。');
    saving = true;
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      let original = '';
      try {
        original = await readFile(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const remaining = new Map(Object.entries(patch));
      const lines = original.split(/\r?\n/).flatMap((line) => {
        const name = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/.exec(line)?.[1];
        if (!name || !(name in patch)) return [line];
        if (!remaining.has(name)) return [];
        remaining.delete(name);
        return [`${name}=${JSON.stringify(patch[name])}`];
      });
      for (const [name, value] of remaining) lines.push(`${name}=${JSON.stringify(value)}`);
      await writeFile(temporary, lines.join('\n').replace(/\n*$/, '\n'), { flag: 'wx', mode: 0o600 });
      // Do not overwrite a manual edit made while this save was being prepared.
      const current = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      if (current !== original) throw new Error('配置文件刚被修改，请重新保存。');
      await rename(temporary, path);
      Object.assign(env, patch); // Apply immediately; the user need not restart the service.
    } catch {
      throw new Error('本地配置保存失败，请检查文件权限后重试。');
    } finally {
      saving = false;
      await unlink(temporary).catch(() => undefined);
    }
  }
  const config = (requireEnabled = true) =>
    modelConfig(requireEnabled ? env : { ...env, ENABLE_RESUME_AI: 'true' });
  const status = () => ({
    enabled: !!config(),
    provider: env.RESUME_PROVIDER === 'openai' ? 'openai' : 'anthropic',
    model: env.RESUME_MODEL?.trim() || null,
    hasKey: !!env[keyName(env.RESUME_PROVIDER === 'openai' ? 'openai' : 'anthropic')]?.trim(),
    configuredProviders: { openai: !!env.OPENAI_API_KEY?.trim(), anthropic: !!env.ANTHROPIC_API_KEY?.trim() },
    openaiBaseUrl: openAiBaseUrlSchema.safeParse(env.OPENAI_BASE_URL ?? '').data ?? DEFAULT_OPENAI_BASE_URL,
    models: MODEL_CHOICES,
    modelPolicy: modelPolicy(
      env.RESUME_PROVIDER === 'openai' ? 'openai' : 'anthropic',
      env.RESUME_MODEL?.trim() || '',
    ),
    budgetLimitUsd: 5,
  });
  return {
    config,
    status,
    async save(value: z.output<typeof settingsInput>) {
      const input = settingsInput.parse(value);
      const baseUrl = input.provider === 'openai' ? candidateBaseUrl(input.baseUrl) : undefined;
      const candidateKey = baseUrl
        ? candidateOpenAiKey(input.apiKey, baseUrl)
        : input.apiKey || env[keyName(input.provider)]?.trim();
      if (input.enabled && !(input.apiKey || env[keyName(input.provider)]?.trim()))
        throw new Error('请先填写 API Key。');
      const known = MODEL_CHOICES.some(
        (item) => item.provider === input.provider && item.model === input.model,
      );
      const unchanged =
        status().provider === input.provider &&
        env.RESUME_MODEL === input.model &&
        !input.apiKey &&
        (input.provider !== 'openai' || baseUrl === savedBaseUrl());
      if (
        input.provider === 'openai' &&
        !known &&
        !unchanged &&
        (!candidateKey || !catalogs.get(fingerprint(candidateKey, baseUrl!))?.has(input.model))
      )
        throw new Error('请先获取当前密钥的模型列表，再选择并保存模型。');
      // Validate here as well for non-HTTP callers; no request is made when saving.
      await persist({
        RESUME_PROVIDER: input.provider,
        RESUME_MODEL: input.model,
        ENABLE_RESUME_AI: String(input.enabled),
        ...(input.apiKey ? { [keyName(input.provider)]: input.apiKey } : {}),
        ...(baseUrl ? { OPENAI_BASE_URL: baseUrl } : {}),
      });
      return status();
    },
    async listModels(value: z.output<typeof modelListInput>) {
      const input = modelListInput.parse(value);
      const baseUrl = candidateBaseUrl(input.baseUrl);
      const key = candidateOpenAiKey(input.apiKey, baseUrl);
      if (!key) throw new Error('请先填写 OpenAI API Key，或使用已经保存的密钥。');
      let response: Response;
      try {
        response = await fetcher(openAiEndpoint(baseUrl, 'models'), {
          method: 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${key}` },
        });
      } catch {
        throw new Error('无法获取模型列表，请检查网络后重试。');
      }
      if (!response.ok) throw new Error(`获取模型列表返回 ${response.status}，请核对密钥及模型读取权限。`);
      const payload = z
        .object({
          object: z.literal('list'),
          data: z.array(z.object({ id: settingsInput.shape.model })).max(5000),
        })
        .safeParse(await response.json().catch(() => null));
      if (!payload.success) throw new Error('模型列表格式不正确，请稍后重试。');
      const ids = [...new Set(payload.data.data.map((item) => item.id))].sort((a, b) => a.localeCompare(b));
      // Bind discovery to this exact destination and key, including unsaved settings.
      catalogs.clear();
      catalogs.set(fingerprint(key, baseUrl), new Set(ids));
      return {
        provider: 'openai',
        source: 'account',
        baseUrl,
        fetchedAt: new Date().toISOString(),
        models: ids.map((model) => ({
          provider: 'openai',
          model,
          label: model,
          ...modelPolicy('openai', model),
        })),
      };
    },
    async remove(provider: AiProvider) {
      if (provider === 'openai') catalogs.clear();
      await persist({
        [keyName(provider)]: '',
        ...(status().provider === provider ? { ENABLE_RESUME_AI: 'false' } : {}),
      });
      return status();
    },
    async check() {
      const current = config(false);
      if (!current) throw new Error('请先保存密钥和模型。');
      const openai = current.provider === 'openai';
      let response: Response;
      try {
        response = await fetcher(
          openai
            ? openAiEndpoint(current.baseUrl, `models/${encodeURIComponent(current.model)}`)
            : `https://api.anthropic.com/v1/models/${encodeURIComponent(current.model)}`,
          {
            method: 'GET',
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
            headers: openai
              ? { Authorization: `Bearer ${current.key}` }
              : { 'x-api-key': current.key, 'anthropic-version': '2023-06-01' },
          },
        );
      } catch {
        throw new Error('无法连接模型服务，请检查网络后重试。');
      }
      // Upstream bodies may echo request details. Never forward them to the page or logs.
      if (!response.ok) throw new Error(`连接检查返回 ${response.status}，请核对密钥、模型名称和访问权限。`);
      const data = z.object({ id: z.string() }).safeParse(await response.json().catch(() => null));
      if (!data.success || data.data.id !== current.model) throw new Error('模型信息未通过检查。');
      return { ok: true, message: '密钥与模型可访问。未发送简历；实际解析能力以解析结果为准。' };
    },
  };
}
