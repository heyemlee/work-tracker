import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_API,
  anthropicAddress,
  DEFAULT_SETTINGS,
  MODELS,
  withDefaults,
  type Settings,
} from './storage';

/** Settings as an older version saved them: any keys, any model's name. */
const older = (kept: Record<string, unknown>) => kept as unknown as Partial<Settings>;

describe('withDefaults', () => {
  it('is the defaults where nothing was kept', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_SETTINGS);
    expect(withDefaults(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('fills in what an older version didn’t keep', () => {
    const settings = withDefaults(older({ outboxUrl: 'http://localhost:5180', language: 'zh' }));
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, outboxUrl: 'http://localhost:5180', language: 'zh' });
  });

  it('keeps a model that’s offered', () => {
    for (const { id } of MODELS) expect(withDefaults({ model: id }).model).toBe(id);
  });

  it('moves a model that’s no longer offered to the one after it', () => {
    expect(withDefaults(older({ model: 'claude-opus-5' })).model).toBe('claude-opus-5-5');
    expect(withDefaults(older({ model: 'claude-sonnet-5' })).model).toBe('claude-sonnet-5-5');
  });

  it('falls to the default from a model it has never heard of', () => {
    expect(withDefaults(older({ model: 'claude-3-opus' })).model).toBe(DEFAULT_SETTINGS.model);
  });

  it('takes an OpenAI-compatible model kept empty as none chosen', () => {
    expect(withDefaults(older({ openaiModel: '' })).openaiModel).toBe(DEFAULT_SETTINGS.openaiModel);
    expect(withDefaults(older({ openaiModel: '  ' })).openaiModel).toBe(DEFAULT_SETTINGS.openaiModel);
    expect(withDefaults({ openaiModel: 'gpt-5.6-luna' }).openaiModel).toBe('gpt-5.6-luna');
  });

  it('offers the default itself', () => {
    expect(MODELS.map((model) => model.id)).toContain(DEFAULT_SETTINGS.model);
  });
});

describe('anthropicAddress', () => {
  it('is Anthropic’s own where none is given', () => {
    expect(anthropicAddress('')).toBe(ANTHROPIC_API);
    expect(anthropicAddress('   ')).toBe(ANTHROPIC_API);
    expect(DEFAULT_SETTINGS.anthropicBaseUrl).toBe(ANTHROPIC_API);
  });

  it('is without what the SDK adds itself', () => {
    expect(anthropicAddress('https://relay.example/v1')).toBe('https://relay.example');
    expect(anthropicAddress(' https://relay.example/v1/ ')).toBe('https://relay.example');
    expect(anthropicAddress('https://relay.example/')).toBe('https://relay.example');
    expect(anthropicAddress('https://relay.example/claude/v1')).toBe('https://relay.example/claude');
  });

  it('is https where no scheme is typed, and as typed where one is', () => {
    expect(anthropicAddress('relay.example')).toBe('https://relay.example');
    expect(anthropicAddress('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
  });

  it('is Anthropic’s own however that is typed', () => {
    expect(anthropicAddress('https://api.anthropic.com/')).toBe(ANTHROPIC_API);
    expect(anthropicAddress('api.anthropic.com/v1')).toBe(ANTHROPIC_API);
  });
});
