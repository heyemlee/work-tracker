import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiKeyItem, DEFAULT_SETTINGS, settingsItem } from '../storage';

const parseResume = vi.fn();
vi.mock('./ai', () => ({ parseResume, NoApiKey: class extends Error {} }));

const { readResumeForOutbox } = await import('./bridge');
const { resumeFactsSchema } = await import('@domain/profile');

describe('reading a resume for Outbox', () => {
  beforeEach(async () => {
    parseResume.mockReset();
    await apiKeyItem.setValue('sk-ant-test');
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, provider: 'anthropic' });
  });

  it('hands back what the model read, with the text the page sent', async () => {
    parseResume.mockResolvedValue(resumeFactsSchema.parse({ name: { first: 'Alex', last: 'Chen' } }));
    const reply = await readResumeForOutbox('JVBERi0x', 'Alex Chen');
    expect(reply.ok).toBe(true);
    expect(parseResume).toHaveBeenCalledWith('JVBERi0x', 'Alex Chen');
  });

  it('calls an empty answer a failure: the model never saw the resume', async () => {
    parseResume.mockResolvedValue(resumeFactsSchema.parse({}));
    expect(await readResumeForOutbox('JVBERi0x', 'Alex Chen')).toEqual({
      ok: false,
      error: 'failed',
      detail: 'The model returned nothing from this resume.',
    });
    expect(await readResumeForOutbox('JVBERi0x', '')).toMatchObject({
      detail: expect.stringMatching(/scan/),
    });
  });
});
