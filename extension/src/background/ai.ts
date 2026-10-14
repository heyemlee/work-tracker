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
import { resumeShape } from '../ai/resumeShape';
import type { Profile } from '../profile/schema';
import {
  ANTHROPIC_API,
  anthropicAddress,
  apiKeyItem,
  getSettings,
  openaiAddress,
  openaiKeyItem,
  usageItem,
  type FinalAnswer,
  type Model,
  type Settings,
} from '../storage';
import { norm, overlap } from '../text';

/**
 * List prices, US dollars per million tokens. Writing to the cache costs 1.25 times the input price on each; what
 * reading from it costs differs. Haiku 5.5's are for prompts of up to 100,000 tokens, which nothing here comes near.
 */
const PRICES: Record<Model, { input: number; output: number; cacheRead: number }> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** A request these models decline goes to another model on Anthropic's side. Haiku 5.5 has no such fallback. */
const fallsBack = (model: Model) => model !== 'claude-haiku-5-5';

export class NoApiKey extends Error {
  constructor() {
    super('No API key in the settings');
    this.name = 'NoApiKey';
  }
}

/** Claude, where the settings say it is. `own`: at Anthropic's own API, not at a proxy speaking for it. */
async function client(): Promise<{ anthropic: Anthropic; model: Model; own: boolean }> {
  const key = await apiKeyItem.getValue();
  if (!key) throw new NoApiKey();
  const { model, anthropicBaseUrl } = await getSettings();
  const address = anthropicAddress(anthropicBaseUrl);
  const own = address === ANTHROPIC_API;
  // The service worker is the only place the key is used; it never reaches a page.
  return {
    anthropic: new Anthropic({
      apiKey: key,
      ...(own ? {} : { baseURL: address }),
      dangerouslyAllowBrowser: true,
      maxRetries: 2,
      timeout: 90_000,
    }),
    model,
    own,
  };
}

/** A request's tokens, and what they cost at Anthropic's list price: a proxy's own prices aren't known. */
async function recordUsage(message: BetaMessage, model: Model, own: boolean): Promise<void> {
  const usage = message.usage;
  const price = PRICES[model];
  const cachedRead = usage.cache_read_input_tokens ?? 0;
  const cachedWrite = usage.cache_creation_input_tokens ?? 0;
  const cost =
    (usage.input_tokens * price.input +
      cachedRead * price.cacheRead +
      cachedWrite * price.input * 1.25 +
      usage.output_tokens * price.output) /
    1e6;
  await addUsage(usage.input_tokens + cachedRead + cachedWrite, usage.output_tokens, own ? cost : 0);
}

/** The last request's count, still being written or done: a form's requests can come back together. */
let counted: Promise<void> = Promise.resolve();

/**
 * Adds a request to today's line, once the request before it has been added: two that read the line at the same
 * time would each write their own sum, and one would be lost. A proxy's prices aren't known, nor an
 * OpenAI-compatible endpoint's, so their cost stays 0.
 */
function addUsage(inputTokens: number, outputTokens: number, cost: number): Promise<void> {
  const added = counted.then(async () => {
    const day = new Date().toLocaleDateString('en-CA');
    const days = await usageItem.getValue();
    const today = days.find((entry) => entry.day === day) ?? {
      day,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    };
    const updated = {
      day,
      inputTokens: today.inputTokens + inputTokens,
      outputTokens: today.outputTokens + outputTokens,
      cost: today.cost + cost,
    };
    await usageItem.setValue([updated, ...days.filter((entry) => entry.day !== day)].slice(0, 90));
  });
  counted = added.catch(() => undefined);
  return added;
}

/**
 * One request. Claude's models may decline a request their safety classifiers flag; the server-side fallback then
 * re-runs it on another model instead of returning the refusal, where the model has one.
 */
interface AskParams {
  system: string;
  /** The applicant's material, cached across a day's requests. */
  material?: string;
  /** A PDF to read, as base64. */
  pdf?: string;
  /** The same PDF's text, for a provider that may not pass a PDF on to its model. */
  pdfText?: string;
  prompt: string;
  effort: 'low' | 'medium';
  maxTokens: number;
  schema?: Record<string, unknown>;
}

/** A model's reply: its text, or why there's none. */
interface Reply {
  text: string | null;
  why: string | null;
  /** The endpoint wouldn't take a reasoning effort, and answered without one. */
  effortRefused?: boolean;
}

async function ask(params: AskParams): Promise<string | null> {
  return (await request(params)).text;
}

/** The system prompt with the answer's shape spelled out, for an endpoint that may drop structured output. */
const shaped = (system: string, schema: Record<string, unknown>) =>
  `${system}\n\nReply with JSON only, in exactly the shape of this JSON schema: every key it lists, and no others.\n${JSON.stringify(schema)}`;

async function request(params: AskParams): Promise<Reply> {
  const settings = await getSettings();
  if (settings.provider === 'openai') return askOpenAI(params, settings);
  const { anthropic, model, own } = await client();
  // A proxy gets the request Anthropic's own API does, but for the fallback, which only that API has. It may hand
  // the request on without the structured output, so the prompt shows the shape too.
  const message = await anthropic.beta.messages.create({
    model,
    max_tokens: params.maxTokens,
    ...(own && fallsBack(model)
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {}),
    output_config: {
      effort: params.effort,
      ...(params.schema ? { format: { type: 'json_schema', schema: params.schema } } : {}),
    },
    system: [
      { type: 'text', text: params.schema && !own ? shaped(params.system, params.schema) : params.system },
    ],
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
  await recordUsage(message, model, own);
  if (message.stop_reason === 'refusal') return { text: null, why: 'the model declined' };
  if (message.stop_reason === 'max_tokens')
    return { text: null, why: 'the answer was cut off at the token limit' };
  const text = message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  return text ? { text, why: null } : { text: null, why: 'the answer was empty' };
}

/** `https://api.kabi.pro` → `https://api.kabi.pro/v1`; an address with a path is used as given. */
export function openaiEndpoint(base: string): string {
  // Saved before the settings made it whole, an address may have no scheme.
  const trimmed = openaiAddress(base);
  return new URL(trimmed).pathname === '/' ? `${trimmed}/v1` : trimmed;
}

async function openaiKey(): Promise<string> {
  const key = await openaiKeyItem.getValue();
  if (!key) throw new NoApiKey();
  return key;
}

type ChatBody = Record<string, unknown>;

const THINKING = { low: 1, medium: 2, high: 4 };

/**
 * The output limit for a request made with another effort than it was sized for. A reasoning model thinks in output
 * tokens, so thinking harder with the same limit ends in an answer cut off unfinished: the room grows in step. It
 * never shrinks, and stops at the largest limit any request here already asks for: an endpoint's own ceiling isn't
 * known.
 */
export function roomFor(limit: number, sized: 'low' | 'medium', effort: 'low' | 'medium' | 'high'): number {
  const more = Math.max(1, THINKING[effort] / THINKING[sized]);
  return Math.max(limit, Math.min(16_000, Math.round(limit * more)));
}

/**
 * The same request over OpenAI's chat completions API, which OpenAI and most proxies speak. Proxies differ in what
 * they accept, so a request refused for `max_completion_tokens` or for structured output is sent again without it;
 * the prompt still asks for JSON.
 */
async function askOpenAI(params: AskParams, settings: Settings): Promise<Reply> {
  const key = await openaiKey();
  if (!settings.openaiModel.trim()) throw new Error('Choose a model in the settings');
  // The owner's choice of effort, or the request's own where they left it to each kind of request.
  const effort = settings.openaiEffort === 'auto' ? params.effort : settings.openaiEffort;
  const content: unknown[] = [];
  // A proxy may accept a PDF part and drop it; the text reaches any model. The file goes only when there's no text.
  if (params.pdfText)
    content.push({ type: 'text', text: `The resume's text, taken from the PDF:\n\n${params.pdfText}` });
  else if (params.pdf)
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
        // A proxy may drop structured output; the schema in the prompt still shows the model the shape.
        content: params.schema ? shaped(params.system, params.schema) : params.system,
      },
      { role: 'user', content },
    ],
    max_completion_tokens: roomFor(params.maxTokens, params.effort, effort),
    // Reasoning models spend output tokens thinking; low effort leaves room for the answer and answers sooner.
    reasoning_effort: effort,
    ...(params.schema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'answer', strict: true, schema: params.schema },
          },
        }
      : {}),
  };

  let effortRefused = false;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${openaiEndpoint(settings.openaiBaseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150_000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      const retry = response.status === 400 && attempt < 3 ? relaxed(body, detail) : null;
      if (retry) {
        if (!('reasoning_effort' in retry) && 'reasoning_effort' in body) effortRefused = true;
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
    const reply = (text: string | null, why: string | null): Reply => ({ text, why, effortRefused });
    if (!choice) return reply(null, 'the endpoint returned no answer');
    if (choice.message?.refusal) return reply(null, `the model declined: ${choice.message.refusal}`);
    if (choice.finish_reason === 'length') return reply(null, 'the answer was cut off at the token limit');
    const text = (choice.message?.content ?? '').trim();
    return text ? reply(text, null) : reply(null, 'the answer was empty');
  }
}

/** The request without what a 400 says the endpoint won't take, or null when it names neither. */
function relaxed(body: ChatBody, detail: string): ChatBody | null {
  if (/max_completion_tokens/i.test(detail) && 'max_completion_tokens' in body) {
    const { max_completion_tokens: limit, ...rest } = body;
    return { ...rest, max_tokens: limit };
  }
  if (/reasoning_effort/i.test(detail) && 'reasoning_effort' in body) {
    const rest = { ...body };
    delete rest.reasoning_effort;
    return rest;
  }
  if (/response_format|json_schema/i.test(detail) && 'response_format' in body) {
    const rest = { ...body };
    delete rest.response_format;
    return rest;
  }
  return null;
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
/** The JSON object in a model's answer, whatever surrounds it (a code fence, a sentence), in the resume's shape. */
export function looseResumeJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in it');
  return resumeShape(JSON.parse(text.slice(start, end + 1)));
}

/** Reads a resume PDF (base64, with its text when the page could read it) into the parts of a profile it settles. */
export async function parseResume(pdf: string, pdfText = ''): Promise<ResumeFacts> {
  const reply = await request({
    system: RESUME_SYSTEM,
    pdf,
    pdfText,
    prompt: 'Read this resume into the schema.',
    effort: 'low',
    maxTokens: 16000,
    schema: RESUME_SCHEMA,
  });
  if (!reply.text) throw new Error(`The model gave no answer: ${reply.why ?? 'unknown reason'}.`);
  const start = `Its answer began: ${reply.text.slice(0, 160)}`;
  let json: unknown;
  try {
    json = looseResumeJson(reply.text);
  } catch (error) {
    throw new Error(
      `The model's answer wasn't JSON (${error instanceof Error ? error.message : error}). ${start}`,
      { cause: error },
    );
  }
  const parsed = resumeFactsSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`The model's answer didn't fit (${issue?.path.join('.')}: ${issue?.message}). ${start}`);
  }
  return parsed.data;
}

/**
 * A tiny request to check the key works, for the settings. It goes out as any other would, so it also tells
 * whether the endpoint takes the reasoning effort it's sent. These models think before they answer, and thinking
 * counts against the limit: there's room for it beside the one word.
 */
export async function checkKey(): Promise<{
  ok: boolean;
  error?: string;
  effortRefused?: boolean;
  /** The provider took the key, and no answer came of the request: why. */
  empty?: string;
}> {
  try {
    const reply = await request({
      system: 'Reply with the word OK.',
      material: 'Key check.',
      prompt: 'Say OK.',
      effort: 'low',
      maxTokens: 1024,
    });
    const effortRefused = reply.effortRefused ?? false;
    // An answer came back, whatever it held: the provider took the key.
    return reply.text === null
      ? { ok: true, effortRefused, empty: reply.why ?? 'the answer was empty' }
      : { ok: true, effortRefused };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
