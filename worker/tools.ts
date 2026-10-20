import { localToolPath } from '../src/domain/localTools';

/** Where the tools service takes the tunnel's requests: its second port, open only with TOOLS_TOKEN set (backend/src/main.ts). */
const SERVICE = 'http://127.0.0.1:3101';
const PREFIX = '/api/tools';
const MAX_BYTES = 6 * 1024 * 1024;

/** What a deployment that connected a tools service has (docs/deploy.md). One that didn't has neither. */
interface ToolsBindings {
  TOOLS?: Fetcher;
  TOOLS_TOKEN?: string;
}

export interface ToolsReply {
  status: number;
  /** Always JSON. */
  body: string;
}

const reply = (status: number, code: string): ToolsReply => ({ status, body: JSON.stringify({ code }) });

/**
 * A signed-in request from Discover or Resume tools, carried to the service on the owner's computer through the
 * Cloudflare Tunnel behind the TOOLS binding. Only the routes the pages call go through, with the service's token in
 * place of the browser's cookies and headers, and only a JSON reply comes back.
 */
export async function forwardToTools(request: Request, env: object): Promise<ToolsReply> {
  const { TOOLS, TOOLS_TOKEN } = env as ToolsBindings;
  if (!TOOLS || !TOOLS_TOKEN) return reply(404, 'NOT_HOSTED');
  const url = new URL(request.url);
  const path = url.pathname.slice(PREFIX.length);
  if (!url.pathname.startsWith(`${PREFIX}/`) || !localToolPath(request.method, path))
    return reply(404, 'NOT_FOUND');
  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET') {
    if (Number(request.headers.get('content-length')) > MAX_BYTES) return reply(413, 'FILE_TOO_LARGE');
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return reply(413, 'FILE_TOO_LARGE');
  }
  const type = request.headers.get('content-type');
  let upstream: Response;
  try {
    upstream = await TOOLS.fetch(`${SERVICE}${path}${url.search}`, {
      method: request.method,
      headers: { Authorization: `Bearer ${TOOLS_TOKEN}`, ...(type ? { 'Content-Type': type } : {}) },
      body,
      redirect: 'manual',
      // A resume parse waits up to 90 s for its model (backend/src/resume/model.ts).
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    // The computer is asleep, or the service or the tunnel isn't running.
    return reply(503, 'SERVICE_UNAVAILABLE');
  }
  if (!upstream.headers.get('content-type')?.includes('application/json'))
    return reply(502, 'SERVICE_UNAVAILABLE');
  return { status: upstream.status, body: await upstream.text() };
}
