import { FROM_EXTENSION, FROM_PAGE, MAX_RESUME_BASE64 } from '@domain/bridge';
import { describe, expect, it, vi } from 'vitest';
import { fromOutbox } from '../background/bridge';
import { startBridge, type BridgeBackend } from './bridge';

const ORIGIN = 'https://tracker.haoyang.us';

function page(backend: Partial<BridgeBackend> = {}) {
  const target = new EventTarget();
  const posted: { type: string; [key: string]: unknown }[] = [];
  const win = Object.assign(target, {
    location: { origin: ORIGIN },
    postMessage: (message: { type: string }) => posted.push(message),
  }) as unknown as Window;
  const send = (
    data: unknown,
    { origin = ORIGIN, source = win as unknown }: { origin?: string; source?: unknown } = {},
  ) => target.dispatchEvent(Object.assign(new Event('message'), { data, origin, source }));
  startBridge(win, {
    readiness: async () => 'ready',
    parse: async () => ({ ok: false, error: 'failed', detail: 'unset' }),
    ...backend,
  });
  return { posted, send };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the bridge to Outbox’s page', () => {
  it('says hello on start and when pinged', async () => {
    const { posted, send } = page({ readiness: async () => 'no-key' });
    send({ source: FROM_PAGE, type: 'ping' });
    await settle();
    expect(posted).toEqual([
      { source: FROM_EXTENSION, type: 'hello', readiness: 'no-key' },
      { source: FROM_EXTENSION, type: 'hello', readiness: 'no-key' },
    ]);
  });

  it('reads a resume and answers with the same id', async () => {
    const parse = vi.fn(async () => ({ ok: true as const, facts: { phone: '+1' } as never }));
    const { posted, send } = page({ parse });
    send({ source: FROM_PAGE, type: 'parse-resume', id: 'r1', pdf: 'JVBERi0x' });
    await settle();
    expect(parse).toHaveBeenCalledWith('JVBERi0x');
    expect(posted.at(-1)).toEqual({
      source: FROM_EXTENSION,
      type: 'parse-result',
      id: 'r1',
      facts: { phone: '+1' },
    });
  });

  it('passes on why a resume couldn’t be read', async () => {
    const { posted, send } = page({ parse: async () => ({ ok: false, error: 'no-key', detail: '' }) });
    send({ source: FROM_PAGE, type: 'parse-resume', id: 'r2', pdf: 'JVBERi0x' });
    send({ source: FROM_PAGE, type: 'parse-resume', id: 'r3', pdf: 'x'.repeat(MAX_RESUME_BASE64 + 1) });
    await settle();
    expect(posted.filter((message) => message.type === 'parse-error')).toEqual([
      { source: FROM_EXTENSION, type: 'parse-error', id: 'r3', error: 'too-large', detail: '' },
      { source: FROM_EXTENSION, type: 'parse-error', id: 'r2', error: 'no-key', detail: '' },
    ]);
  });

  it('ignores other windows, other origins and other senders', async () => {
    const parse = vi.fn();
    const { send } = page({ parse });
    const message = { source: FROM_PAGE, type: 'parse-resume', id: 'r4', pdf: 'JVBERi0x' };
    send(message, { origin: 'https://evil.example' });
    send(message, { source: {} });
    send({ ...message, source: 'someone-else' });
    await settle();
    expect(parse).not.toHaveBeenCalled();
  });

  it('only takes requests from Outbox’s own pages', () => {
    expect(fromOutbox('https://tracker.haoyang.us/')).toBe(true);
    expect(fromOutbox('http://localhost:5180/?x=1')).toBe(true);
    expect(fromOutbox('https://tracker.haoyang.us.evil.example/')).toBe(false);
    expect(fromOutbox('https://jobs.lever.co/acme')).toBe(false);
    expect(fromOutbox(undefined)).toBe(false);
  });
});
