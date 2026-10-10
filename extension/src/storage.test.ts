import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, MODELS, withDefaults, type Settings } from './storage';

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
