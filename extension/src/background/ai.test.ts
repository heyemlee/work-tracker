import { beforeEach, describe, expect, it, vi } from 'vitest';
import { afterEach } from 'vitest';
import { apiKeyItem, DEFAULT_SETTINGS, openaiKeyItem, settingsItem, usageItem } from '../storage';
import { makeProfile } from '../test/profiles';

const create = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { create } };
  },
}));

const { answerFields, draftAnswer, listOpenAIModels, NoApiKey, openaiEndpoint, parseResume } =
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
      model: 'claude-opus-5',
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    });
  });

  it('records what each request cost', async () => {
    create.mockResolvedValue(reply(JSON.stringify({ answers: [] })));
    await answerFields(questions, makeProfile(), null, '2026-09-27');
    const [today] = await usageItem.getValue();
    // Opus 5 at $5 in / $25 out per million tokens: 1000 × 5 + 200 × 25 = 10,000 micro-dollars.
    expect(today?.cost).toBeCloseTo(0.01, 6);
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

  it('returns nothing when the model declines or answers badly', async () => {
    create.mockResolvedValue(reply('', 'refusal'));
    expect(await parseResume('JVBERi0xLjQK')).toBeNull();
    create.mockResolvedValue(reply('not json'));
    expect(await parseResume('JVBERi0xLjQK')).toBeNull();
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
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    expect(JSON.stringify(body)).not.toMatch(/F-1|STEM OPT|sponsor|veteran/i);
    const [today] = await usageItem.getValue();
    expect(today).toMatchObject({ inputTokens: 900, outputTokens: 100, cost: 0 });
  });

  it('sends a resume as a PDF file part', async () => {
    fetchMock.mockResolvedValue(
      answer('```json\n{"name":{"first":"Alex","last":"Chen","preferred":""}}\n```'),
    );
    const facts = await parseResume('JVBERi0xLjQK');
    expect(facts?.name.first).toBe('Alex');
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.messages[1].content[0]).toEqual({
      type: 'file',
      file: { filename: 'resume.pdf', file_data: 'data:application/pdf;base64,JVBERi0xLjQK' },
    });
  });

  it('tries again without what a proxy refuses', async () => {
    fetchMock
      .mockResolvedValueOnce(answer('Unsupported parameter: max_completion_tokens', 400))
      .mockResolvedValueOnce(answer('response_format json_schema is not supported', 400))
      .mockResolvedValueOnce(answer(JSON.stringify({ answers: [] })));
    expect(await answerFields(questions, makeProfile(), null, '2026-09-27')).toEqual([]);
    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call as [string, RequestInit])[1].body)),
    );
    expect(bodies[1]).toMatchObject({ max_tokens: 4000 });
    expect(bodies[1].max_completion_tokens).toBeUndefined();
    expect(bodies[2].response_format).toBeUndefined();
    expect(bodies[2].messages[0].content).toMatch(/Reply with JSON only/);
  });

  it('needs its own key, and lists the models the endpoint offers', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-5.6' }] })),
    );
    expect(await listOpenAIModels()).toEqual(['gpt-5.6', 'gpt-5.6-terra']);
    await openaiKeyItem.setValue('');
    await expect(answerFields(questions, makeProfile(), null, '2026-09-27')).rejects.toBeInstanceOf(NoApiKey);
  });
});
