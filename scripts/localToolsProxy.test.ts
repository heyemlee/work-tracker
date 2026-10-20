import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { ViteDevServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { localToolPath } from '../src/domain/localTools';
import { localToolsProxy, trustedLocalRequest } from './localToolsProxy';

describe('local bridge boundary', () => {
  const valid = {
    method: 'POST',
    headers: { host: '127.0.0.1:5180', origin: 'http://127.0.0.1:5180', 'x-outbox-local': '1' },
  };
  it('accepts only same-origin loopback requests with the explicit local header', () => {
    expect(trustedLocalRequest(valid, 5180)).toBe(true);
    for (const headers of [
      { ...valid.headers, host: 'attacker.example:5180' },
      { ...valid.headers, origin: 'https://attacker.example' },
      { ...valid.headers, origin: undefined },
      { ...valid.headers, 'x-outbox-local': undefined },
      { ...valid.headers, host: '127.0.0.1:9999' },
    ])
      expect(trustedLocalRequest({ method: 'POST', headers }, 5180)).toBe(false);
    expect(
      trustedLocalRequest({ method: 'GET', headers: { ...valid.headers, origin: undefined } }, 5180),
    ).toBe(true);
    expect(trustedLocalRequest({ method: 'GET', headers: { ...valid.headers, origin: 'null' } }, 5180)).toBe(
      false,
    );
  });
  it('does not expose arbitrary routes or allow writes through reads', () => {
    expect(localToolPath('POST', '/api/resumes/parse')).toBe(true);
    expect(localToolPath('GET', '/api/resumes/status')).toBe(true);
    expect(localToolPath('GET', '/api/snapshot')).toBe(false);
    expect(localToolPath('GET', '/api/resumes/parse')).toBe(false);
    expect(localToolPath('POST', '/api/jobs')).toBe(false);
    expect(localToolPath('GET', '/.env')).toBe(false);
    expect(localToolPath('GET', '//attacker.example/api/boards')).toBe(false);
  });

  it('forwards only approved headers and returns a precise unavailable response without leaking upstream details', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ text: 'fictional resume' }, { headers: { 'Set-Cookie': 'must-not-forward=true' } }),
      )
      .mockRejectedValueOnce(new Error('private upstream details'));
    type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
    let handler: Handler = () => {
      throw new Error('Middleware was not registered');
    };
    const configure = localToolsProxy(upstream).configureServer as (server: ViteDevServer) => void;
    configure({
      middlewares: {
        use: (fn: Handler) => {
          handler = fn;
        },
      },
    } as unknown as ViteDevServer);
    const server = createServer((req, res) =>
      handler(req, res, () => {
        res.writeHead(418);
        res.end('worker');
      }),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const response = await fetch(`${origin}/local-tools/api/resumes/extract`, {
        method: 'POST',
        headers: {
          Origin: origin,
          'x-outbox-local': '1',
          Cookie: 'fake-main-session',
          Authorization: 'Bearer fake-main-token',
          'Content-Type': 'application/octet-stream',
        },
        body: 'synthetic file',
      });
      expect(response.status).toBe(200);
      expect(response.headers.has('set-cookie')).toBe(false);
      const [destination, options] = upstream.mock.calls[0]!;
      expect(String(destination)).toBe('http://127.0.0.1:3100/api/resumes/extract');
      expect(options?.headers).toEqual({
        Origin: 'http://127.0.0.1:3100',
        'x-outbox-local': '1',
        'Content-Type': 'application/octet-stream',
      });
      expect(options?.redirect).toBe('error');
      const offline = await fetch(`${origin}/local-tools/health`, { headers: { 'x-outbox-local': '1' } });
      expect(offline.status).toBe(503);
      expect(await offline.json()).toEqual({ code: 'SERVICE_UNAVAILABLE' });
      const worker = await fetch(`${origin}/api/resumes`);
      expect(worker.status).toBe(418);
      expect(upstream).toHaveBeenCalledTimes(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
