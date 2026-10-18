import { describe, expect, it } from 'vitest';
import { keyVerdict } from '../../entrypoints/options/keyVerdict';
import { strings } from '../../entrypoints/options/strings';

const s = strings('en');

describe('what the settings say of a key check', () => {
  it('says the key is bad only where the provider turned it away', () => {
    expect(keyVerdict({ ok: false, error: '401 invalid x-api-key' }, false, s)).toMatchObject({
      tone: 'bad',
    });
    expect(keyVerdict({ ok: false, error: '403 forbidden' }, false, s)).toMatchObject({ tone: 'bad' });
  });

  it('says the check couldn’t be made where nothing was learned of the key', () => {
    for (const error of ['404 Not Found', '503 Service Unavailable', 'Connection error.'])
      expect(keyVerdict({ ok: false, error }, false, s)).toMatchObject({
        tone: 'warn',
        text: expect.stringContaining('Couldn’t check the key'),
      });
  });

  it('says it’s the model to change, not the key, where the provider has no model by that name', () => {
    const error =
      '404 {"error":{"message":"Model \\"gpt-5.6-terra\\" is not supported by any configured account in this group","type":"model_not_found"}}';
    expect(keyVerdict({ ok: false, error }, false, s)).toEqual({
      tone: 'warn',
      text: 'The key works, but this endpoint has no model by the name chosen: pick another one above.',
    });
  });

  it('says the key works where the provider took it and no answer came back', () => {
    expect(
      keyVerdict({ ok: true, empty: 'the answer was cut off at the token limit' }, false, s),
    ).toMatchObject({ tone: 'warn', text: expect.stringContaining('The key works') });
  });
});
