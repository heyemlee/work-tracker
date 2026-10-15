import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MAX_OUTPUT_TOKENS, resumeRequest, type AiProvider, type Method } from './model.js';
import { fileURLToPath } from 'node:url';

// Standard synchronous provider API prices, checked 2026-10-14. No batch, fast-mode or caching discounts assumed.
export const PRICE_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';
const rates: Record<string, { input: number; output: number; longContext?: boolean }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-5.4': { input: 2.5, output: 15, longContext: true },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-6.1-sol': { input: 2, output: 10, longContext: true },
  'gpt-6-astra': { input: 10, output: 50, longContext: true },
  'gpt-6-luna': { input: 0.1, output: 0.5, longContext: true },
  'gpt-6-sol': { input: 2, output: 10, longContext: true },
  'gpt-5.6-sol': { input: 4, output: 20, longContext: true },
};
export const EVAL_LEDGER = fileURLToPath(
  new URL('../../../evals/private/budget-ledger.json', import.meta.url),
);
export const MODEL_CHOICES = [
  { provider: 'openai', model: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
  { provider: 'openai', model: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
  { provider: 'openai', model: 'gpt-6-astra', label: 'GPT-6 Astra' },
  { provider: 'openai', model: 'gpt-6-luna', label: 'GPT-6 Luna' },
  { provider: 'openai', model: 'gpt-6-sol', label: 'GPT-6 Sol' },
  { provider: 'openai', model: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { provider: 'openai', model: 'gpt-5.4', label: 'GPT-5.4' },
  { provider: 'openai', model: 'gpt-4.1', label: 'GPT-4.1' },
  { provider: 'openai', model: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { provider: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { provider: 'anthropic', model: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
] as const;
/** Availability comes from the provider. This local policy only describes reviewed task support/pricing. */
export function modelPolicy(provider: AiProvider, model: string) {
  const supported = MODEL_CHOICES.some((item) => item.provider === provider && item.model === model);
  const unrelated =
    provider === 'openai' &&
    /^(?:text-embedding-|text-moderation-|omni-moderation|whisper-|tts-|dall-e-|sora(?:-|$)|gpt-(?:image|audio|realtime|live|transcribe)(?:-|$)|gpt-4o(?:-mini)?-(?:audio|realtime|transcribe|tts))/i.test(
      model,
    );
  return {
    canParse: supported,
    selectable: !unrelated,
    reason: supported
      ? '已核实解析方式和价格，实际可用性以账号权限为准。'
      : unrelated
        ? '该型号用于音频、图像或其它任务，不用于这里的简历解析。'
        : '该型号的解析兼容性与价格尚未核实；可保存选择，暂不发送简历。',
  };
}
function applicableRate(model: string, inputTokens: number) {
  const rate = rates[model];
  return rate?.longContext && inputTokens > 272_000
    ? { input: rate.input * 2, output: rate.output * 1.5 }
    : rate;
}
export function quoteRequest(
  text: string,
  method: Method,
  model: string,
  provider: AiProvider = 'anthropic',
) {
  const rate = rates[model];
  if (!rate || !MODEL_CHOICES.some((item) => item.provider === provider && item.model === model))
    throw new Error('No verified evaluation price for this model. Update the price table before a paid run.');
  const bytes = Buffer.byteLength(JSON.stringify(resumeRequest(text, method, model, provider)), 'utf8');
  // Deliberately conservative, NOT a tokenizer estimate: four tokens per payload byte, plus 16K tokens
  // for server/tool/schema overhead, and the full output cap. Never present this reservation as actual cost.
  const reservedInputTokens = bytes * 4 + 16_384;
  const reservationRate = applicableRate(model, reservedInputTokens)!;
  const reservedMicrousd = Math.ceil(
    reservedInputTokens * reservationRate.input + MAX_OUTPUT_TOKENS * reservationRate.output,
  );
  return {
    model,
    provider,
    method,
    payloadBytes: bytes,
    reservedInputTokens,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    reservedMicrousd,
    reservedUsd: reservedMicrousd / 1_000_000,
    priceSource:
      provider === 'openai' ? `https://developers.openai.com/api/docs/models/${model}` : PRICE_SOURCE,
    priceChecked: '2026-10-14',
  };
}
const entrySchema = z.strictObject({
  id: z.string(),
  caseId: z.string(),
  model: z.string(),
  provider: z.enum(['openai', 'anthropic']).optional(),
  method: z.string(),
  reservedMicrousd: z.number().int().nonnegative(),
  at: z.string(),
  actualMicrousd: z.number().int().nonnegative().nullable(),
});
const ledgerSchema = z.strictObject({
  version: z.literal(1),
  limitMicrousd: z.number().int().positive(),
  entries: z.array(entrySchema),
});

/** One shared, private ledger for both methods and repeated runs. Reservations survive errors and process crashes. */
export async function withBudget<T>(
  path: string,
  limitUsd: number,
  work: (budget: {
    reserve: (caseId: string, quote: ReturnType<typeof quoteRequest>) => Promise<string>;
    recordUsage: (id: string, usage: { input_tokens: number; output_tokens: number } | null) => Promise<void>;
    summary: () => { reservedUsd: number; actualKnownUsd: number; unresolvedCalls: number; limitUsd: number };
  }) => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(limitUsd) || limitUsd <= 0 || limitUsd > 5)
    throw new Error('This evaluation is authorized for at most $5.');
  const lockPath = `${path}.lock`;
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw new Error(
      'Evaluation ledger is locked. Another run may be active; inspect it before removing a stale lock.',
    );
  });
  try {
    await lock.writeFile(`${process.pid}\n`);
    let ledger: z.output<typeof ledgerSchema>;
    try {
      ledger = ledgerSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Cannot read budget ledger; refusing to reset prior spend.', { cause: error });
      ledger = { version: 1, limitMicrousd: Math.floor(limitUsd * 1_000_000), entries: [] };
    }
    const limit = Math.min(ledger.limitMicrousd, Math.floor(limitUsd * 1_000_000));
    ledger.limitMicrousd = limit;
    const persist = async () => {
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
    };
    const spent = () =>
      ledger.entries.reduce(
        (total, entry) => total + Math.max(entry.reservedMicrousd, entry.actualMicrousd ?? 0),
        0,
      );
    await persist();
    return await work({
      async reserve(caseId, quote) {
        if (ledger.entries.some((entry) => (entry.actualMicrousd ?? 0) > entry.reservedMicrousd))
          throw new Error('A prior call exceeded its reservation; budget is halted.');
        if (spent() + quote.reservedMicrousd > limit)
          throw new Error('Insufficient remaining evaluation budget; no request sent.');
        const id = randomUUID();
        ledger.entries.push({
          id,
          caseId,
          model: quote.model,
          provider: quote.provider,
          method: quote.method,
          at: new Date().toISOString(),
          reservedMicrousd: quote.reservedMicrousd,
          actualMicrousd: null,
        });
        await persist(); // Must complete before the paid call starts.
        return id;
      },
      async recordUsage(id, usage) {
        const entry = ledger.entries.find((item) => item.id === id);
        if (!entry || !usage) return;
        const rate = applicableRate(entry.model, usage.input_tokens);
        if (!rate) throw new Error('Unknown ledger model price.');
        entry.actualMicrousd = Math.ceil(usage.input_tokens * rate.input + usage.output_tokens * rate.output);
        await persist();
        if (entry.actualMicrousd > entry.reservedMicrousd)
          throw new Error(
            'Provider usage exceeded conservative reservation. Halt and inspect billing before any further request.',
          );
      },
      summary: () => ({
        reservedUsd: spent() / 1_000_000,
        actualKnownUsd:
          ledger.entries.reduce((total, entry) => total + (entry.actualMicrousd ?? 0), 0) / 1_000_000,
        unresolvedCalls: ledger.entries.filter((entry) => entry.actualMicrousd === null).length,
        limitUsd: limit / 1_000_000,
      }),
    });
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
