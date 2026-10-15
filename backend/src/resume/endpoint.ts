import { z } from 'zod';

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Base paths are preserved; a bare host uses the conventional /v1 API prefix. */
export function normalizeOpenAiBaseUrl(value = DEFAULT_OPENAI_BASE_URL) {
  const raw = value.trim() || DEFAULT_OPENAI_BASE_URL;
  try {
    if (raw.length > 2048 || /[\s\\?#]/.test(raw)) throw new Error();
    const url = new URL(raw);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password)
      throw new Error();
    const path = url.pathname.replace(/\/+$/, '');
    if (/\/(?:responses|chat\/completions|models(?:\/.*)?)$/i.test(path)) throw new Error();
    url.pathname = path || '/v1';
    return url.href.replace(/\/+$/, '');
  } catch {
    throw new Error(
      'Base URL 请填写 HTTPS API 根地址（如 https://api.openai.com/v1）；本机服务可用 HTTP。不要填写密钥、查询参数或完整接口路径。',
    );
  }
}

export const openAiBaseUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .transform((value, ctx) => {
    try {
      return normalizeOpenAiBaseUrl(value);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message });
      return z.NEVER;
    }
  });

export function openAiEndpoint(baseUrl: string | undefined, resource: string) {
  return `${normalizeOpenAiBaseUrl(baseUrl)}/${resource}`;
}
