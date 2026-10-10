import { beforeEach, describe, expect, it, vi } from 'vitest';
import { afterEach } from 'vitest';
import {
  apiKeyItem,
  DEFAULT_SETTINGS,
  openaiKeyItem,
  settingsItem,
  usageItem,
  type Settings,
} from '../storage';
import { makeProfile } from '../test/profiles';

const create = vi.fn();
/** What each client was made with: the key, and the address where it isn't Anthropic's own. */
const made = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { create } };
    constructor(options: unknown) {
      made(options);
    }
  },
}));

const { answerFields, checkKey, draftAnswer, NoApiKey, openaiEndpoint, parseResume, roomFor } =
  await import('./ai');

function reply(text: string, stop = 'end_turn') {
  return {
    content: [{ type: 'text', text }],
    stop_reason: stop,
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}

const questions = [
  {
    id: 'a',
    label: 'Which describes your AI use?',
    description: '',
    kind: 'combobox' as const,
    options: ['I build agents', 'I don’t use AI'],
    required: true,
  },
  {
    id: 'b',
    label: 'Preferred coding language',
    description: '',
    kind: 'text' as const,
    options: [],
    required: true,
  },
  { id: 'c', label: 'Favorite color', description: '', kind: 'text' as const, options: [], required: true },
];

describe('answerFields', () => {
  beforeEach(async () => {
    create.mockReset();
    await apiKeyItem.setValue('sk-ant-test');
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, provider: 'anthropic' });
    await usageItem.setValue([]);
  });

  it('keeps confident answers, drops guesses and options the page doesn’t offer', async () => {
    create.mockResolvedValue(
      reply(
        JSON.stringify({
          answers: [
            { id: 'a', answer: 'I build agents', choices: [], confidence: 0.9, reason: 'AI engineer' },
            { id: 'b', answer: 'Python', choices: [], confidence: 0.8, reason: 'skills' },
            { id: 'c', answer: 'Blue', choices: [], confidence: 0.2, reason: 'guess' },
          ],
        }),
      ),
    );
    const answers = await answerFields(questions, makeProfile(), null, '2026-09-27');
    expect(answers.map((answer) => answer.id)).toEqual(['a', 'b']);
  });

  it('rejects a choice that isn’t one of the options', async () => {
    create.mockResolvedValue(
      reply(
        JSON.stringify({
          answers: [{ id: 'a', answer: 'Sometimes', choices: [], confidence: 0.95, reason: '' }],
        }),
      ),
    );
    expect(await answerFields(questions, makeProfile(), null, '2026-09-27')).toEqual([]);
  });

  it('sends no voluntary self-identification or work authorization in the applicant block', async () => {
    create.mockResolvedValue(reply(JSON.stringify({ answers: [] })));
    await answerFields(questions, makeProfile(), null, '2026-09-27');
    const request = JSON.stringify(create.mock.calls[0]?.[0]);
    expect(request).not.toMatch(/F-1|STEM OPT|sponsor|citizenship|decline|veteran|disability/i);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    });
  });

  it('asks for no fallback of the model that has none', async () => {
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, provider: 'anthropic', model: 'claude-haiku-5-5' });
    create.mockResolvedValue(reply(JSON.stringify({ answers: [] })));
    await answerFields(questions, makeProfile(), null, '2026-09-27');
    const sent = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.model).toBe('claude-haiku-5-5');
    expect(sent).not.toHaveProperty('fallbacks');
    expect(sent).not.toHaveProperty('betas');
  });

  it('asks the model that took the place of one the settings no longer offer', async () => {
    // As an older version of the settings saved it.
    await settingsItem.setValue({
      ...DEFAULT_SETTINGS,
      provider: 'anthropic',
      model: 'claude-sonnet-5',
    } as unknown as Settings);
    create.mockResolvedValue(reply(JSON.stringify({ answers: [] })));
    await answerFields(questions, makeProfile(), null, '2026-09-27');
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default' });
  });

  it('records what each request cost', async () => {
    create.mockResolvedValue(reply(JSON.stringify({ answers: [] })));
    await answerFields(questions, makeProfile(), null, '2026-09-27');
    const [today] = await usageItem.getValue();
    // Opus 5.5 at $4 in / $20 out per million tokens: 1000 × 4 + 200 × 20 = 8,000 micro-dollars.
    expect(today?.cost).toBeCloseTo(0.008, 6);
  });

  it.each([
    // In micro-dollars: 1000 in, 100,000 read from the cache, 10,000 written to it (1.25 × in), 200 out.
    ['claude-fable-5-1', 1000 * 10 + 100_000 * 0.25 + 10_000 * 12.5 + 200 * 50],
    ['claude-opus-5-5', 1000 * 4 + 100_000 * 0.2 + 10_000 * 5 + 200 * 20],
    ['claude-sonnet-5-5', 1000 * 2 + 100_000 * 0.1 + 10_000 * 2.5 + 200 * 10],
    ['claude-haiku-5-5', 1000 * 0.1 + 100_000 * 0.01 + 10_000 * 0.125 + 200 * 0.5],
  ] as const)('prices %s by its own list, the cache included', async (model, microDollars) => {
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, provider: 'anthropic', model });
    create.mockResolvedValue({
      ...reply(JSON.stringify({ answers: [] })),
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 100_000,
        cache_creation_input_tokens: 10_000,
      },
    });
    await answerFields(questions, makeProfile(), null, '2026-09-27');
    const [today] = await usageItem.getValue();
    expect(today?.cost).toBeCloseTo(microDollars / 1e6, 9);
    expect(today?.inputTokens).toBe(111_000);
  });

  it('counts every request of a form, though they come back together', async () => {
    create.mockResolvedValue(reply(JSON.stringify({ answers: [] })));
    await Promise.all([1, 2, 3].map(() => answerFields(questions, makeProfile(), null, '2026-09-27')));
    const [today] = await usageItem.getValue();
    expect(today).toMatchObject({ inputTokens: 3000, outputTokens: 600 });
  });

  it('needs a key', async () => {
    await apiKeyItem.setValue('');
    await expect(answerFields(questions, makeProfile(), null, '2026-09-27')).rejects.toBeInstanceOf(NoApiKey);
  });
});

describe('draftAnswer', () => {
  beforeEach(async () => {
    create.mockReset();
    await apiKeyItem.setValue('sk-ant-test');
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, provider: 'anthropic' });
  });

  it('returns nothing when the model declines', async () => {
    create.mockResolvedValue(reply('', 'refusal'));
    const draft = await draftAnswer(
      { ...questions[1]!, label: 'Why us?', kind: 'textarea', maxLength: 500 },
      makeProfile(),
      null,
      '2026-09-27',
      [],
    );
    expect(draft).toBeNull();
  });

  it('keeps a draft within the field’s limit', async () => {
    create.mockResolvedValue(reply('x'.repeat(900)));
    const draft = await draftAnswer(
      { ...questions[1]!, label: 'Why us?', kind: 'textarea', maxLength: 300 },
      makeProfile(),
      null,
      '2026-09-27',
      [],
    );
    expect(draft).toHaveLength(300);
  });

  it('ends a shortened draft on a whole sentence', async () => {
    create.mockResolvedValue(reply(`${'a'.repeat(200)}. ${'b'.repeat(80)}. ${'c'.repeat(100)}.`));
    const draft = await draftAnswer(
      { ...questions[1]!, label: 'Why us?', kind: 'textarea', maxLength: 300 },
      makeProfile(),
      null,
      '2026-09-27',
      [],
    );
    expect(draft).toBe(`${'a'.repeat(200)}. ${'b'.repeat(80)}.`);
  });

  it('leaves the length to the question when the field has no limit', async () => {
    create.mockResolvedValue(reply('y'.repeat(2000)));
    const draft = await draftAnswer(
      { ...questions[1]!, label: 'Why us?', kind: 'textarea', maxLength: null },
      makeProfile(),
      null,
      '2026-09-27',
      [],
    );
    expect(draft).toHaveLength(2000);
    expect(JSON.stringify(create.mock.calls[0]?.[0])).toContain('No character limit.');
  });
});

describe('parseResume', () => {
  beforeEach(async () => {
    create.mockReset();
    await apiKeyItem.setValue('sk-ant-test');
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, provider: 'anthropic' });
  });

  it('sends the PDF with the schema, and reads the answer loosely', async () => {
    create.mockResolvedValue(
      reply(
        JSON.stringify({
          name: { first: 'Alex', last: 'Chen', preferred: '' },
          education: [{ school: 'Santa Clara University', level: 'masters' }],
          experience: [
            { company: 'Acme AI', title: 'AI Engineer', start: '2025-06', end: '', type: 'full-time' },
          ],
          skills: ['Python'],
        }),
      ),
    );
    const facts = await parseResume('JVBERi0xLjQK');
    expect(facts?.name.first).toBe('Alex');
    expect(facts?.education[0]?.level).toBe('other');
    const request = create.mock.calls[0]?.[0];
    expect(request.messages[0].content[0]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQK' },
    });
    expect(request.output_config.format.type).toBe('json_schema');
    expect(request.output_config.format.schema.required).toContain('experience');
  });

  it('says why it has nothing: declined, cut off, not JSON', async () => {
    create.mockResolvedValue(reply('', 'refusal'));
    await expect(parseResume('JVBERi0xLjQK')).rejects.toThrow(/no answer: the model declined/);
    create.mockResolvedValue(reply('{"name": {"first": "Al', 'max_tokens'));
    await expect(parseResume('JVBERi0xLjQK')).rejects.toThrow(/cut off/);
    create.mockResolvedValue(reply('Sorry, I can only see an image.'));
    await expect(parseResume('JVBERi0xLjQK')).rejects.toThrow(/wasn't JSON.*Sorry, I can only see/);
  });

  it('reads an answer loosely: wrapped in prose, nulls, numbers, a skills line', async () => {
    create.mockResolvedValue(
      reply(
        'Here is the JSON:\n```json\n{"name":{"first":"Alex","last":"Chen","preferred":null},"phone":null,' +
          '"education":[{"school":"MIT","gpa":3.9,"start":null}],"skills":"Python, Go; SQL"}\n```',
      ),
    );
    const facts = await parseResume('JVBERi0xLjQK');
    expect(facts.name).toEqual({ first: 'Alex', last: 'Chen', preferred: '' });
    expect(facts.education[0]).toMatchObject({ school: 'MIT', gpa: '3.9', start: '' });
    expect(facts.skills).toEqual(['Python', 'Go', 'SQL']);
  });
});

describe('Claude at another address than Anthropic’s', () => {
  const at = (anthropicBaseUrl: string) =>
    settingsItem.setValue({ ...DEFAULT_SETTINGS, provider: 'anthropic', anthropicBaseUrl });
  const asked = async () => {
    create.mockResolvedValue(reply(JSON.stringify({ answers: [] })));
    await answerFields(questions, makeProfile(), null, '2026-09-27');
    const sent = create.mock.calls.at(-1)?.[0] as {
      system: { text: string }[];
      output_config: unknown;
    } & Record<string, unknown>;
    return { sent, client: made.mock.calls.at(-1)?.[0] as Record<string, unknown> };
  };

  beforeEach(async () => {
    create.mockReset();
    made.mockReset();
    await apiKeyItem.setValue('sk-relay-test');
    await at('https://relay.example');
    await usageItem.setValue([]);
  });

  it('is asked there, with the same key', async () => {
    const { client } = await asked();
    expect(client).toMatchObject({ apiKey: 'sk-relay-test', baseURL: 'https://relay.example' });
    // However the address was saved: the SDK adds `/v1` itself.
    await at('relay.example/v1/');
    expect((await asked()).client).toMatchObject({ baseURL: 'https://relay.example' });
  });

  it('isn’t asked for the fallback, which only Anthropic’s own API has, and is told the answer’s shape in words too', async () => {
    const { sent } = await asked();
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent).not.toHaveProperty('fallbacks');
    expect(sent).not.toHaveProperty('betas');
    expect(sent.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(sent.system[0]?.text).toContain('Reply with JSON only');
    expect(sent.system[0]?.text).toContain('"confidence"');
  });

  it('has its tokens counted, and no cost: its prices aren’t Anthropic’s', async () => {
    await asked();
    const [today] = await usageItem.getValue();
    expect(today).toMatchObject({ inputTokens: 1000, outputTokens: 200, cost: 0 });
  });

  it('is Anthropic’s own API again where the settings name it, or none', async () => {
    for (const address of ['https://api.anthropic.com', 'api.anthropic.com/v1/', '']) {
      await at(address);
      const { sent, client } = await asked();
      expect(client).not.toHaveProperty('baseURL');
      expect(sent).toMatchObject({ fallbacks: 'default' });
      expect(sent.system[0]?.text).not.toContain('Reply with JSON only');
    }
    const [today] = await usageItem.getValue();
    expect(today?.cost).toBeGreaterThan(0);
  });
});

describe('checkKey', () => {
  beforeEach(async () => {
    create.mockReset();
    await apiKeyItem.setValue('sk-ant-test');
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, provider: 'anthropic' });
    await usageItem.setValue([]);
  });

  it('leaves the model room to think before its one word', async () => {
    create.mockResolvedValue(reply('OK'));
    expect(await checkKey()).toEqual({ ok: true, effortRefused: false });
    expect(create.mock.calls[0]?.[0]).toMatchObject({ max_tokens: 1024, output_config: { effort: 'low' } });
  });

  it('says what the provider said of a key it turns away', async () => {
    create.mockRejectedValue(new Error('401 {"type":"error","error":{"message":"invalid x-api-key"}}'));
    expect(await checkKey()).toMatchObject({
      ok: false,
      error: expect.stringContaining('invalid x-api-key'),
    });
  });

  it('says why when the request went through and no answer came of it', async () => {
    create.mockResolvedValue(reply('', 'max_tokens'));
    expect(await checkKey()).toMatchObject({ ok: false, error: 'the answer was cut off at the token limit' });
  });
});

describe('an OpenAI-compatible provider', () => {
  const fetchMock = vi.fn();
  const answer = (content: string, status = 200) =>
    new Response(
      status === 200
        ? JSON.stringify({
            choices: [{ message: { content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 900, completion_tokens: 100 },
          })
        : content,
      { status },
    );

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    await openaiKeyItem.setValue('sk-proxy');
    await usageItem.setValue([]);
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, provider: 'openai' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks the default model where the settings kept none', async () => {
    // As the settings could be left while the model's name was typed, not picked.
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, provider: 'openai', openaiModel: '' });
    fetchMock.mockImplementation(async () => answer('OK'));
    expect(await checkKey()).toMatchObject({ ok: true });
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as { model: string };
    expect(body.model).toBe(DEFAULT_SETTINGS.openaiModel);
  });

  it('adds /v1 to a bare address', () => {
    expect(openaiEndpoint('https://api.kabi.pro')).toBe('https://api.kabi.pro/v1');
    expect(openaiEndpoint('https://api.kabi.pro/')).toBe('https://api.kabi.pro/v1');
    expect(openaiEndpoint('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
  });

  it('asks chat completions with the model, the key and a strict schema', async () => {
    fetchMock.mockResolvedValue(
      answer(
        JSON.stringify({
          answers: [{ id: 'b', answer: 'Python', choices: [], confidence: 0.9, reason: '' }],
        }),
      ),
    );
    const answers = await answerFields(questions, makeProfile(), null, '2026-09-27');
    expect(answers.map((entry) => entry.id)).toEqual(['b']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.kabi.pro/v1/chat/completions');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer sk-proxy');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('gpt-5.6-terra');
    expect(body.reasoning_effort).toBe('low');
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    expect(JSON.stringify(body)).not.toMatch(/F-1|STEM OPT|sponsor|veteran/i);
    const [today] = await usageItem.getValue();
    expect(today).toMatchObject({ inputTokens: 900, outputTokens: 100, cost: 0 });
  });

  it('sends a resume as its text, and as a PDF file only when it has none', async () => {
    fetchMock.mockImplementation(async () =>
      answer('```json\n{"name":{"first":"Alex","last":"Chen","preferred":""}}\n```'),
    );
    const facts = await parseResume('JVBERi0xLjQK', 'Alex Chen\nAI Engineer, Acme AI');
    expect(facts?.name.first).toBe('Alex');
    await parseResume('JVBERi0xLjQK', '');
    const [withText, scan] = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call as [string, RequestInit])[1].body)),
    );
    expect(withText.messages[1].content[0].text).toContain('AI Engineer, Acme AI');
    expect(JSON.stringify(withText)).not.toContain('application/pdf');
    expect(scan.messages[1].content[0]).toEqual({
      type: 'file',
      file: { filename: 'resume.pdf', file_data: 'data:application/pdf;base64,JVBERi0xLjQK' },
    });
  });

  it('tries again without what a proxy refuses', async () => {
    fetchMock
      .mockResolvedValueOnce(answer('Unsupported parameter: max_completion_tokens', 400))
      .mockResolvedValueOnce(answer('response_format json_schema is not supported', 400))
      .mockResolvedValueOnce(answer('Unrecognized request argument supplied: reasoning_effort', 400))
      .mockResolvedValueOnce(answer(JSON.stringify({ answers: [] })));
    expect(await answerFields(questions, makeProfile(), null, '2026-09-27')).toEqual([]);
    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call as [string, RequestInit])[1].body)),
    );
    expect(bodies[1]).toMatchObject({ max_tokens: 4000 });
    expect(bodies[1].max_completion_tokens).toBeUndefined();
    expect(bodies[2].response_format).toBeUndefined();
    expect(bodies[2].messages[0].content).toMatch(/Reply with JSON only/);
    expect(bodies[3].reasoning_effort).toBeUndefined();
  });

  it('needs its own key', async () => {
    await openaiKeyItem.setValue('');
    await expect(answerFields(questions, makeProfile(), null, '2026-09-27')).rejects.toBeInstanceOf(NoApiKey);
  });

  const sent = () =>
    fetchMock.mock.calls.map((call) => JSON.parse(String((call as [string, RequestInit])[1].body)));
  const question = { ...questions[1]!, maxLength: null };

  it('thinks as hard as each request asks, left to itself', async () => {
    fetchMock.mockImplementation(async () => answer('Python, mostly.'));
    await answerFields(questions, makeProfile(), null, '2026-09-27').catch(() => undefined);
    await draftAnswer(question, makeProfile(), null, '2026-09-27', []);
    expect(sent().map((body) => [body.reasoning_effort, body.max_completion_tokens])).toEqual([
      ['low', 4000],
      ['medium', 3000],
    ]);
  });

  it('thinks as hard as the owner chose, with room to think in', async () => {
    fetchMock.mockImplementation(async () => answer('Python, mostly.'));
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, provider: 'openai', openaiEffort: 'high' });
    await answerFields(questions, makeProfile(), null, '2026-09-27').catch(() => undefined);
    await draftAnswer(question, makeProfile(), null, '2026-09-27', []);
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, provider: 'openai', openaiEffort: 'low' });
    await draftAnswer(question, makeProfile(), null, '2026-09-27', []);
    expect(sent().map((body) => [body.reasoning_effort, body.max_completion_tokens])).toEqual([
      ['high', 16000],
      ['high', 6000],
      // Less effort than a draft was sized for leaves its room as it was.
      ['low', 3000],
    ]);
  });

  it('gives more effort more room, never less, and no more than a request already asks for', () => {
    expect(roomFor(4000, 'low', 'low')).toBe(4000);
    expect(roomFor(4000, 'low', 'medium')).toBe(8000);
    expect(roomFor(3000, 'medium', 'low')).toBe(3000);
    expect(roomFor(16000, 'low', 'high')).toBe(16000);
    expect(roomFor(200, 'low', 'high')).toBe(800);
  });

  it('says so when the endpoint won’t take an effort, as the key check finds out', async () => {
    fetchMock.mockImplementation(async () => answer('OK'));
    expect(await checkKey()).toEqual({ ok: true, effortRefused: false });
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(answer('Unrecognized request argument supplied: reasoning_effort', 400))
      .mockResolvedValueOnce(answer('OK'));
    expect(await checkKey()).toEqual({ ok: true, effortRefused: true });
    fetchMock.mockReset().mockResolvedValue(answer('Incorrect API key provided', 401));
    expect(await checkKey()).toMatchObject({ ok: false, error: expect.stringContaining('401') });
  });
});
