import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiKeyItem, usageItem } from '../storage';
import { makeProfile } from '../test/profiles';

const create = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { create } };
  },
}));

const { answerFields, draftAnswer, NoApiKey } = await import('./ai');

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
