import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';
import type { FieldKind, Posting } from '../model';
import { resumeFactsSchema, type ResumeFacts } from '@domain/profile';
import {
  DRAFT_SYSTEM,
  FIELD_SCHEMA,
  FIELD_SYSTEM,
  material,
  postingBlock,
  RESUME_SCHEMA,
  RESUME_SYSTEM,
} from '../ai/prompts';
import type { Profile } from '../profile/schema';
import {
  apiKeyItem,
  getSettings,
  openaiKeyItem,
  usageItem,
  type FinalAnswer,
  type Model,
  type Settings,
} from '../storage';
import { norm, overlap } from '../text';

/** List prices, US dollars per million tokens: [input, output]. */
const PRICES: Record<Model, [number, number]> = {
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [2, 10],
};

export class NoApiKey extends Error {
  constructor() {
    super('No API key on the options page');
    this.name = 'NoApiKey';
  }
}

async function client(): Promise<{ anthropic: Anthropic; model: Model }> {
  const key = await apiKeyItem.getValue();
  if (!key) throw new NoApiKey();
  const { model } = await getSettings();
  // The service worker is the only place the key is used; it never reaches a page.
  return {
    anthropic: new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 90_000 }),
    model,
  };
}

async function recordUsage(message: BetaMessage, model: Model): Promise<void> {
  const usage = message.usage;
  const [inputPrice, outputPrice] = PRICES[model];
  const cachedRead = usage.cache_read_input_tokens ?? 0;
  const cachedWrite = usage.cache_creation_input_tokens ?? 0;
  const cost =
    (usage.input_tokens * inputPrice +
      cachedRead * inputPrice * 0.1 +
      cachedWrite * inputPrice * 1.25 +
      usage.output_tokens * outputPrice) /
    1e6;
  await addUsage(usage.input_tokens + cachedRead + cachedWrite, usage.output_tokens, cost);
}

/** Adds a request to today's line. An OpenAI-compatible endpoint's prices aren't known, so its cost stays 0. */
async function addUsage(inputTokens: number, outputTokens: number, cost: number): Promise<void> {
  const day = new Date().toLocaleDateString('en-CA');
  const days = await usageItem.getValue();
  const today = days.find((entry) => entry.day === day) ?? { day, inputTokens: 0, outputTokens: 0, cost: 0 };
  const updated = {
    day,
    inputTokens: today.inputTokens + inputTokens,
    outputTokens: today.outputTokens + outputTokens,
    cost: today.cost + cost,
  };
  await usageItem.setValue([updated, ...days.filter((entry) => entry.day !== day)].slice(0, 90));
}

/**
 * One request. Claude Opus 5 may decline a request its safety classifiers flag; the server-side fallback then
 * re-runs it on another model instead of returning the refusal.
 */
interface AskParams {
  system: string;
  /** The applicant's material, cached across a day's requests. */
  material?: string;
  /** A PDF to read, as base64. */
  pdf?: string;
  prompt: string;
  effort: 'low' | 'medium';
  maxTokens: number;
  schema?: Record<string, unknown>;
}

async function ask(params: AskParams): Promise<string | null> {
  const settings = await getSettings();
  if (settings.provider === 'openai') return askOpenAI(params, settings);
  const { anthropic, model } = await client();
  const message = await anthropic.beta.messages.create({
    model,
    max_tokens: params.maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: params.effort,
      ...(params.schema ? { format: { type: 'json_schema', schema: params.schema } } : {}),
    },
    system: [{ type: 'text', text: params.system }],
    messages: [
      {
        role: 'user',
        content: [
          ...(params.pdf
            ? [
                {
                  type: 'document' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: 'application/pdf' as const,
                    data: params.pdf,
                  },
                },
              ]
            : []),
          // The applicant's material repeats across a day's requests; caching it makes each later one cheaper.
          ...(params.material
            ? [
                {
                  type: 'text' as const,
                  text: params.material,
                  cache_control: { type: 'ephemeral' as const },
                },
              ]
            : []),
          { type: 'text' as const, text: params.prompt },
        ],
      },
    ],
  });
  await recordUsage(message, model);
  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') return null;
  const text = message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  return text || null;
}

/** `https://api.kabi.pro` → `https://api.kabi.pro/v1`; an address with a path is used as given. */
export function openaiEndpoint(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  return new URL(trimmed).pathname === '/' ? `${trimmed}/v1` : trimmed;
}

async function openaiKey(): Promise<string> {
  const key = await openaiKeyItem.getValue();
  if (!key) throw new NoApiKey();
  return key;
}

type ChatBody = Record<string, unknown>;

/**
 * The same request over OpenAI's chat completions API, which OpenAI and most proxies speak. Proxies differ in what
 * they accept, so a request refused for `max_completion_tokens` or for structured output is sent again without it;
 * the prompt still asks for JSON.
 */
async function askOpenAI(params: AskParams, settings: Settings): Promise<string | null> {
  const key = await openaiKey();
  if (!settings.openaiModel.trim()) throw new Error('Choose a model on the options page');
  const content: unknown[] = [];
  if (params.pdf)
    content.push({
      type: 'file',
      file: { filename: 'resume.pdf', file_data: `data:application/pdf;base64,${params.pdf}` },
    });
  if (params.material) content.push({ type: 'text', text: params.material });
  content.push({ type: 'text', text: params.prompt });
  let body: ChatBody = {
    model: settings.openaiModel.trim(),
    messages: [
      {
        role: 'system',
        content: params.schema ? `${params.system}\n\nReply with JSON only.` : params.system,
      },
      { role: 'user', content },
    ],
    max_completion_tokens: params.maxTokens,
    ...(params.schema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'answer', strict: true, schema: params.schema },
          },
        }
      : {}),
  };

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${openaiEndpoint(settings.openaiBaseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      const retry = response.status === 400 && attempt < 2 ? relaxed(body, detail) : null;
      if (retry) {
        body = retry;
        continue;
      }
      throw new Error(`${response.status} ${detail}`);
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    await addUsage(data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0, 0);
    const choice = data.choices?.[0];
    if (!choice || choice.message?.refusal || choice.finish_reason === 'length') return null;
    const text = (choice.message?.content ?? '').trim();
    // Without structured output some models wrap the JSON in a code fence.
    return (
      text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim() || null
    );
  }
}

/** The request without what a 400 says the endpoint won't take, or null when it names neither. */
function relaxed(body: ChatBody, detail: string): ChatBody | null {
  if (/max_completion_tokens/i.test(detail) && 'max_completion_tokens' in body) {
    const { max_completion_tokens: limit, ...rest } = body;
    return { ...rest, max_tokens: limit };
  }
  if (/response_format|json_schema/i.test(detail) && 'response_format' in body) {
    const rest = { ...body };
    delete rest.response_format;
    return rest;
  }
  return null;
}

/** The models an OpenAI-compatible endpoint offers, for the options page. */
export async function listOpenAIModels(): Promise<string[]> {
  const [settings, key] = await Promise.all([getSettings(), openaiKey()]);
  const response = await fetch(`${openaiEndpoint(settings.openaiBaseUrl)}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
  const data = (await response.json()) as { data?: { id?: string }[] };
  return (data.data ?? []).flatMap((model) => (model.id ? [model.id] : [])).sort();
}

export interface FieldQuestion {
  id: string;
  label: string;
  description: string;
  kind: FieldKind;
  options: string[];
  required: boolean;
}

export interface FieldAnswer {
  id: string;
  answer: string;
  choices: string[];
  confidence: number;
  reason: string;
}

const fieldAnswers = z.object({
  answers: z.array(
    z.object({
      id: z.string(),
      answer: z.string(),
      choices: z.array(z.string()),
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
});

/** Answers the form's leftover fields in one request. Only answers clearing `threshold` come back. */
export async function answerFields(
  questions: FieldQuestion[],
  profile: Profile,
  posting: Posting | null,
  today: string,
  threshold = 0.7,
): Promise<FieldAnswer[]> {
  if (questions.length === 0) return [];
  const list = questions.map((question) => ({
    id: question.id,
    question: question.label,
    help: question.description || undefined,
    kind: question.kind,
    options: question.options.length ? question.options : undefined,
  }));
  const text = await ask({
    system: FIELD_SYSTEM,
    material: material(profile, today),
    prompt: `${postingBlock(posting)}\n<questions>\n${JSON.stringify(list, null, 1)}\n</questions>`,
    effort: 'low',
    maxTokens: 4000,
    schema: FIELD_SCHEMA,
  });
  if (!text) return [];
  const parsed = fieldAnswers.safeParse(JSON.parse(text));
  if (!parsed.success) return [];
  const byId = new Map(questions.map((question) => [question.id, question]));
  return parsed.data.answers.filter((answer) => {
    const question = byId.get(answer.id);
    if (!question || answer.confidence < threshold) return false;
    // A choice must be one of the options the page offers.
    if (question.options.length && question.kind !== 'multi')
      return question.options.some((option) => norm(option) === norm(answer.answer));
    if (question.kind === 'multi') return answer.choices.length > 0;
    return answer.answer.trim() !== '';
  });
}

/** Picks up to three of the owner's edited answers to similar questions, as examples of their voice. */
export function similarFinals(finals: readonly FinalAnswer[], question: string): FinalAnswer[] {
  return [...finals]
    .map((final) => ({ final, score: overlap(final.question, question) }))
    .filter((entry) => entry.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => entry.final);
}

export async function draftAnswer(
  question: FieldQuestion & { maxLength: number | null },
  profile: Profile,
  posting: Posting | null,
  today: string,
  examples: FinalAnswer[],
): Promise<string | null> {
  const limit = question.maxLength;
  const exampleBlock = examples.length
    ? `<examples>\n${examples.map((example) => `Q (${example.company}): ${example.question}\nA: ${example.text}`).join('\n\n')}\n</examples>\n`
    : '';
  const text = await ask({
    system: DRAFT_SYSTEM,
    material: material(profile, today),
    prompt: `${postingBlock(posting)}\n${exampleBlock}<question>${question.label}${question.description ? `\n${question.description}` : ''}</question>\n${limit ? `Character limit: ${limit}.` : 'No character limit.'}`,
    effort: 'medium',
    maxTokens: 3000,
  });
  if (!text) return null;
  return limit ? fitTo(text, limit) : text;
}

/** Shortens a draft to the field's limit, ending on a whole sentence when one fits in most of it. */
function fitTo(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const room = text.slice(0, limit + 1);
  const end = Math.max(...['. ', '! ', '? ', '.\n', '!\n', '?\n'].map((stop) => room.lastIndexOf(stop)));
  return end >= limit / 2 ? text.slice(0, end + 1) : text.slice(0, limit);
}

/** Reads a resume PDF (base64) into the parts of a profile it settles. Null when the model can't. */
export async function parseResume(pdf: string): Promise<ResumeFacts | null> {
  const text = await ask({
    system: RESUME_SYSTEM,
    pdf,
    prompt: 'Read this resume into the schema.',
    effort: 'low',
    maxTokens: 8000,
    schema: RESUME_SCHEMA,
  });
  if (!text) return null;
  try {
    const parsed = resumeFactsSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A tiny request to check the key works, for the options page. */
export async function checkKey(): Promise<{ ok: boolean; error?: string }> {
  try {
    const answer = await ask({
      system: 'Reply with the word OK.',
      material: 'Key check.',
      prompt: 'Say OK.',
      effort: 'low',
      maxTokens: 200,
    });
    return { ok: answer !== null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
