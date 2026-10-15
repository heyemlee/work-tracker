import { z } from 'zod';
import { MAX_TEXT_CHARS } from './extract.js';
import { PROMPT_VERSION, RESUME_SYSTEM, resumeJsonSchema, resumeSchema } from './schema.js';
import { openAiBaseUrlSchema, openAiEndpoint } from './endpoint.js';

export const methodSchema = z.enum(['function-calling', 'structured-output']);
export type Method = z.output<typeof methodSchema>;
export const MAX_OUTPUT_TOKENS = 8192;
export const aiProviderSchema = z.enum(['openai', 'anthropic']);
export type AiProvider = z.output<typeof aiProviderSchema>;
export type ModelConfig = { model: string; key: string; provider?: AiProvider; baseUrl?: string };
export const parseInputSchema = z.strictObject({
  text: z.string().trim().min(1).max(MAX_TEXT_CHARS),
  method: methodSchema,
});
export function modelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig | null {
  const model = env.RESUME_MODEL?.trim();
  const provider = env.RESUME_PROVIDER ?? 'anthropic';
  if (!aiProviderSchema.safeParse(provider).success) return null;
  const base = openAiBaseUrlSchema.safeParse(env.OPENAI_BASE_URL ?? '');
  if (provider === 'openai' && !base.success) return null;
  const key = (provider === 'openai' ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY)?.trim();
  return env.ENABLE_RESUME_AI === 'true' && model && key
    ? provider === 'openai'
      ? { model, key, provider: 'openai' as const, ...(env.OPENAI_BASE_URL ? { baseUrl: base.data } : {}) }
      : { model, key }
    : null;
}

/** Shared by the offline budget quote and the actual request, so they reserve the same payload. */
export function resumeRequest(
  text: string,
  method: Method,
  model: string,
  provider: AiProvider = 'anthropic',
) {
  parseInputSchema.parse({ text, method });
  if (provider === 'openai') {
    const schema = { ...resumeJsonSchema };
    delete schema.$schema;
    const output =
      method === 'function-calling'
        ? {
            tools: [
              {
                type: 'function',
                name: 'extract_resume',
                description: 'Extract only the resume facts in the supplied schema.',
                strict: true,
                parameters: schema,
              },
            ],
            tool_choice: { type: 'function', name: 'extract_resume' },
            parallel_tool_calls: false,
          }
        : { text: { format: { type: 'json_schema', name: 'resume_facts', strict: true, schema } } };
    return {
      model,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      store: false,
      instructions: RESUME_SYSTEM,
      input: [{ role: 'user', content: JSON.stringify({ resumeText: text }) }],
      ...output,
    };
  }
  const output =
    method === 'function-calling'
      ? {
          tools: [
            {
              name: 'extract_resume',
              description:
                'Return the facts explicitly stated in the resume. Fill all schema keys, leaving missing facts empty. Do not modify the profile or perform any actions.',
              strict: true,
              input_schema: resumeJsonSchema,
            },
          ],
          tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        }
      : { output_config: { format: { type: 'json_schema', schema: resumeJsonSchema } } };
  return {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: RESUME_SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify({ resumeText: text }) }],
    ...output,
  };
}

/** One request, no automatic retry or repair loop: a failed response never silently becomes partial profile data. */
export async function parseResume(
  text: string,
  method: Method,
  config: ModelConfig,
  fetcher: typeof fetch = fetch,
) {
  parseInputSchema.parse({ text, method });
  const started = performance.now();
  const provider = config.provider ?? 'anthropic';
  const endpoint =
    provider === 'openai'
      ? openAiEndpoint(config.baseUrl, 'responses')
      : 'https://api.anthropic.com/v1/messages';
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(90_000),
      headers:
        provider === 'openai'
          ? { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` }
          : {
              'Content-Type': 'application/json',
              'x-api-key': config.key,
              'anthropic-version': '2023-06-01',
            },
      body: JSON.stringify(resumeRequest(text, method, config.model, provider)),
    });
  } catch {
    throw new Error('模型请求失败或超时，未自动重试。');
  }
  if (!response.ok) throw new Error(`模型服务返回 ${response.status}，请检查服务配置或额度。`);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error('模型服务没有返回有效 JSON。');
  }
  if (provider === 'openai')
    return readOpenAi(json, method, config.model, Math.round(performance.now() - started));
  const envelope = z
    .object({
      stop_reason: z.string(),
      content: z.array(z.object({ type: z.string() }).passthrough()),
      usage: z
        .object({ input_tokens: z.number().nonnegative(), output_tokens: z.number().nonnegative() })
        .optional(),
    })
    .safeParse(json);
  if (!envelope.success) throw new Error('模型响应格式不正确。');
  const data = envelope.data;
  let candidate: unknown;
  if (method === 'function-calling') {
    const calls = data.content.filter((item) => item.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || calls.length !== 1 || calls[0].name !== 'extract_resume')
      throw new Error('模型没有完成一次有效的资料提取调用（可能拒答、截断或未调用工具）。');
    candidate = calls[0].input;
  } else {
    const blocks = data.content.filter((item) => item.type === 'text');
    if (data.stop_reason !== 'end_turn' || blocks.length !== 1 || typeof blocks[0].text !== 'string')
      throw new Error('模型没有完成完整的结构化输出（可能拒答或截断）。');
    try {
      candidate = JSON.parse(blocks[0].text);
    } catch {
      throw new Error('模型输出不是有效 JSON。');
    }
  }
  const facts = resumeSchema.safeParse(candidate);
  if (!facts.success)
    throw new Error(
      `模型结果未通过字段校验：${facts.error.issues
        .map((i) => i.path.join('.') || '(root)')
        .slice(0, 6)
        .join('、')}。`,
    );
  return {
    facts: facts.data,
    model: config.model,
    method,
    promptVersion: PROMPT_VERSION,
    usage: data.usage ?? null,
    durationMs: Math.round(performance.now() - started),
    provider,
  };
}

function readOpenAi(json: unknown, method: Method, model: string, durationMs: number) {
  const envelope = z
    .object({
      status: z.string(),
      output: z.array(z.object({ type: z.string() }).passthrough()),
      usage: z
        .object({ input_tokens: z.number().nonnegative(), output_tokens: z.number().nonnegative() })
        .optional(),
    })
    .safeParse(json);
  if (!envelope.success) throw new Error('OpenAI 响应格式不正确。');
  const data = envelope.data;
  if (data.status !== 'completed')
    throw new Error('OpenAI 未完成完整输出（可能截断、过滤或失败），未自动重试。');
  const rawContents = data.output
    .filter((item) => item.type === 'message')
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []));
  const checked = z
    .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
    .safeParse(rawContents);
  if (!checked.success) throw new Error('OpenAI 响应内容格式不正确。');
  const contents = checked.data;
  if (contents.some((item: { type?: string }) => item.type === 'refusal'))
    throw new Error('OpenAI 拒绝了这次提取请求。');
  const calls = data.output.filter((item) => item.type === 'function_call');
  let candidate: unknown;
  try {
    if (method === 'function-calling') {
      if (
        calls.length !== 1 ||
        calls[0].name !== 'extract_resume' ||
        typeof calls[0].arguments !== 'string' ||
        (calls[0].status && calls[0].status !== 'completed')
      )
        throw new Error('invalid');
      candidate = JSON.parse(calls[0].arguments);
    } else {
      const blocks = contents.filter((item: { type?: string }) => item.type === 'output_text');
      if (calls.length || blocks.length !== 1 || typeof blocks[0].text !== 'string')
        throw new Error('invalid');
      candidate = JSON.parse(blocks[0].text);
    }
  } catch {
    throw new Error('OpenAI 没有返回一次完整有效的资料提取结果。');
  }
  const facts = resumeSchema.safeParse(candidate);
  if (!facts.success) throw new Error('OpenAI 结果未通过字段校验，请核对后重试。');
  return {
    facts: facts.data,
    model,
    method,
    provider: 'openai' as const,
    promptVersion: PROMPT_VERSION,
    usage: data.usage ?? null,
    durationMs,
  };
}
