import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { modelConfig, parseResume } from '../src/resume/model.js';
import { quoteRequest } from '../src/resume/budget.js';
const facts = JSON.parse(await readFile(new URL('../evals/synthetic/gold.json', import.meta.url), 'utf8'));
const config = { provider: 'openai' as const, model: 'gpt-5.4-mini', key: 'fake-test-key-never-real' };
const response = (output: unknown, status = 'completed') =>
  new Response(JSON.stringify({ status, output, usage: { input_tokens: 123, output_tokens: 456 } }));
const call = {
  type: 'function_call',
  name: 'extract_resume',
  arguments: JSON.stringify(facts),
  status: 'completed',
  call_id: 'one',
};
describe('OpenAI resume extraction', () => {
  it('selects only the configured provider key and keeps the opt-in behavior', () => {
    expect(
      modelConfig({ RESUME_PROVIDER: 'openai', RESUME_MODEL: config.model, OPENAI_API_KEY: config.key }),
    ).toBeNull();
    expect(
      modelConfig({
        ENABLE_RESUME_AI: 'true',
        RESUME_PROVIDER: 'openai',
        RESUME_MODEL: config.model,
        ANTHROPIC_API_KEY: 'wrong-provider',
      }),
    ).toBeNull();
    expect(
      modelConfig({
        ENABLE_RESUME_AI: 'true',
        RESUME_PROVIDER: 'openai',
        RESUME_MODEL: config.model,
        OPENAI_API_KEY: config.key,
      }),
    ).toEqual(config);
  });
  it('sends strict Responses function calling without server storage', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([call]));
    const result = await parseResume('Resume source', 'function-calling', config, fetcher);
    const [url, options] = fetcher.mock.calls[0],
      body = JSON.parse(String(options?.body));
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.key}`,
    });
    expect(body).toMatchObject({
      store: false,
      model: config.model,
      max_output_tokens: 8192,
      parallel_tool_calls: false,
      tool_choice: { type: 'function', name: 'extract_resume' },
    });
    expect(body.tools[0]).toMatchObject({
      type: 'function',
      strict: true,
      name: 'extract_resume',
      parameters: { additionalProperties: false },
    });
    expect(JSON.parse(body.input[0].content)).toEqual({ resumeText: 'Resume source' });
    expect(result).toMatchObject({
      facts,
      provider: 'openai',
      usage: { input_tokens: 123, output_tokens: 456 },
    });
  });
  it('uses a separate strict structured-output request', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response([{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(facts) }] }]),
      );
    expect((await parseResume('Resume', 'structured-output', config, fetcher)).facts).toEqual(facts);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.tools).toBeUndefined();
    expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'resume_facts', strict: true });
  });
  it.each([
    [[call], 'incomplete'],
    [[], 'completed'],
    [[call, call], 'completed'],
    [[{ ...call, name: 'unexpected' }], 'completed'],
    [[{ ...call, arguments: '{broken' }], 'completed'],
    [[{ type: 'message', content: [{ type: 'refusal', refusal: 'Refused' }] }], 'completed'],
    [[{ ...call, arguments: JSON.stringify({ ...facts, phone: undefined }) }], 'completed'],
  ])('rejects invalid, missing, multiple, refused or truncated outputs', async (output, status) => {
    await expect(
      parseResume(
        'Resume',
        'function-calling',
        config,
        vi.fn().mockResolvedValue(response(output, status as string)),
      ),
    ).rejects.toThrow();
  });
  it('does not retry or echo upstream details on failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('secret upstream payload', { status: 401 }));
    await expect(parseResume('Resume', 'function-calling', config, fetcher)).rejects.toThrow('401');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reserves the OpenAI price and rejects provider/model mismatch', () => {
    const quote = quoteRequest('Resume', 'function-calling', config.model, 'openai');
    expect(quote.provider).toBe('openai');
    expect(quote.reservedUsd).toBeGreaterThan(0);
    expect(() => quoteRequest('Resume', 'function-calling', config.model, 'anthropic')).toThrow('verified');
  });
});
