import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { localToolPath } from '../src/domain/localTools';

const PREFIX = '/local-tools';
const TARGET = 'http://127.0.0.1:3100';
const MAX_BYTES = 6 * 1024 * 1024;

export function trustedLocalRequest(
  request: Pick<IncomingMessage, 'headers' | 'method'>,
  port: number,
): boolean {
  const { host, origin } = request.headers;
  if (!host || ![`localhost:${port}`, `127.0.0.1:${port}`].includes(host)) return false;
  if (request.headers['x-outbox-local'] !== '1') return false;
  if (origin && origin !== `http://${host}`) return false;
  // A same-origin fetch may omit Origin on GET, but every mutation must carry it.
  return request.method === 'GET' || origin === `http://${host}`;
}

/** Development only, on loopback. Validate the browser boundary before adapting to LocalGuard's origin. */
export function localToolsProxy(fetcher: typeof fetch = fetch): Plugin {
  return {
    name: 'outbox-local-tools',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith(`${PREFIX}/`)) return next();
        const reply = (status: number, code: string) => {
          response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ code }));
        };
        if (
          !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '') ||
          !trustedLocalRequest(request, request.socket.localPort ?? 0)
        )
          return reply(403, 'LOCAL_ONLY');
        let url: URL;
        try {
          url = new URL(request.url.slice(PREFIX.length), TARGET);
        } catch {
          return reply(404, 'NOT_FOUND');
        }
        const method = request.method ?? 'GET';
        if (url.origin !== TARGET || !localToolPath(method, url.pathname)) return reply(404, 'NOT_FOUND');
        try {
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of request) {
            bytes += chunk.length;
            if (bytes > MAX_BYTES) return reply(413, 'FILE_TOO_LARGE');
            chunks.push(Buffer.from(chunk));
          }
          // Allowlist headers: no session cookies, Authorization, or forwarded host headers reach NestJS.
          const upstream = await fetcher(url, {
            method,
            headers: {
              'x-outbox-local': '1',
              Origin: TARGET,
              ...(request.headers['content-type'] ? { 'Content-Type': request.headers['content-type'] } : {}),
            },
            body: method === 'GET' ? undefined : Buffer.concat(chunks),
            redirect: 'error',
            signal: AbortSignal.timeout(180_000),
          });
          if (!upstream.headers.get('content-type')?.includes('application/json'))
            return reply(502, 'SERVICE_UNAVAILABLE');
          response.writeHead(upstream.status, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          response.end(await upstream.text());
        } catch {
          // Do not expose upstream request details or configuration in errors.
          reply(503, 'SERVICE_UNAVAILABLE');
        }
      });
    },
  };
}
