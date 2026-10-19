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
    status: async () => ({ readiness: 'ready', version: '0.1.0', logged: false }),
    parse: async () => ({ ok: false, error: 'failed', detail: 'unset' }),
    openOptions: async () => undefined,
    language: async () => undefined,
    ...backend,
  });
  return { posted, send };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the bridge to Outbox’s page', () => {
  it('says hello on start and when pinged, with its version and whether it has logged', async () => {
    const { posted, send } = page({
      status: async () => ({ readiness: 'no-key', version: '0.2.0', logged: true }),
    });
    send({ source: FROM_PAGE, type: 'ping' });
    await settle();
    const hello = {
      source: FROM_EXTENSION,
      type: 'hello',
      readiness: 'no-key',
      version: '0.2.0',
      logged: true,
    };
    expect(posted).toEqual([hello, hello]);
  });

  it('shows its settings when the page asks, and says hello again once they’re closed', async () => {
    let close = () => {};
    const openOptions = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          close = resolve;
        }),
    );
    const { posted, send } = page({ openOptions });
    send({ source: FROM_PAGE, type: 'open-options' });
    await settle();
    expect(openOptions).toHaveBeenCalledOnce();
    // The hello it starts with, and nothing more while the settings are open.
    expect(posted).toHaveLength(1);
    close();
    await settle();
    expect(posted.map((message) => message.type)).toEqual(['hello', 'hello']);
  });

  it('keeps the language Outbox’s pings say it shows', async () => {
    const language = vi.fn(async () => undefined);
    const { posted, send } = page({ language });
    send({ source: FROM_PAGE, type: 'ping', locale: 'zh' });
    send({ source: FROM_PAGE, type: 'ping', locale: 'fr' });
    send({ source: FROM_PAGE, type: 'ping' });
    await settle();
    expect(language.mock.calls).toEqual([['zh']]);
    // Each ping is answered all the same.
    expect(posted.map((message) => message.type)).toEqual(['hello', 'hello', 'hello', 'hello']);
  });

  it('reads a resume and answers with the same id', async () => {
    const parse = vi.fn(async () => ({ ok: true as const, facts: { phone: '+1' } as never }));
    const { posted, send } = page({ parse });
    send({ source: FROM_PAGE, type: 'parse-resume', id: 'r1', pdf: 'JVBERi0x', text: 'Alex Chen' });
    await settle();
    expect(parse).toHaveBeenCalledWith('JVBERi0x', 'Alex Chen');
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
