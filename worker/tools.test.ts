import { describe, expect, it, vi } from 'vitest';
import { forwardToTools } from './tools';

const TOKEN = 'a-tools-token';

/** A tools binding that keeps what reached the service and answers with `answer`. */
function service(
  answer: (request: Request) => Response | Promise<Response> = () => Response.json({ ok: true }),
) {
  const seen: Request[] = [];
  const TOOLS = {
    fetch: vi.fn((input: RequestInfo, init?: RequestInit) => {
      const request = new Request(input, init);
      seen.push(request);
      return answer(request);
    }),
  } as unknown as Fetcher;
  return { env: { TOOLS, TOOLS_TOKEN: TOKEN }, seen };
}

const tools = (path: string, init?: RequestInit) =>
  new Request(`https://outbox.example/api/tools${path}`, init);

describe('the tools gateway', () => {
  it("says the tools aren't hosted where no service was connected", async () => {
    expect(await forwardToTools(tools('/api/boards'), {})).toEqual({
      status: 404,
      body: '{"code":"NOT_HOSTED"}',
    });
    const { env, seen } = service();
    expect(await forwardToTools(tools('/api/boards'), { TOOLS: env.TOOLS })).toMatchObject({ status: 404 });
    expect(seen).toEqual([]);
  });

  it('passes only the routes the pages call', async () => {
    const { env, seen } = service();
    for (const [method, path] of [
      ['GET', '/api/snapshot'],
      ['POST', '/api/jobs'],
      ['GET', '/'],
      ['GET', '/resume-lab'],
      ['GET', '/.env'],
      ['DELETE', '/api/boards'],
    ] as const)
      expect(await forwardToTools(tools(path, { method }), env)).toEqual({
        status: 404,
        body: '{"code":"NOT_FOUND"}',
      });
    expect(seen).toEqual([]);
  });

  it("sends the service token in place of the browser's cookies, with the query and body as they were", async () => {
    const { env, seen } = service();
    await forwardToTools(
      tools('/api/jobs?q=compiler&remote=true', {
        headers: {
          cookie: 'session=secret',
          authorization: 'Bearer browser',
          origin: 'https://outbox.example',
        },
      }),
      env,
    );
    const [get] = seen;
    expect(get?.url).toBe('http://127.0.0.1:3101/api/jobs?q=compiler&remote=true');
    expect(Object.fromEntries(get?.headers ?? [])).toEqual({ authorization: `Bearer ${TOKEN}` });

    await forwardToTools(
      tools('/api/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'session=secret' },
        body: '{"company":"Example","url":"https://boards.greenhouse.io/example"}',
      }),
      env,
    );
    const post = seen[1];
    expect(post?.method).toBe('POST');
    expect(Object.fromEntries(post?.headers ?? [])).toEqual({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    });
    expect(await post?.json()).toEqual({ company: 'Example', url: 'https://boards.greenhouse.io/example' });
  });

  it("hands back the service's JSON with its status", async () => {
    const { env } = service(() => Response.json({ message: 'Choose a resume file first.' }, { status: 400 }));
    expect(await forwardToTools(tools('/api/resumes/extract', { method: 'POST' }), env)).toEqual({
      status: 400,
      body: '{"message":"Choose a resume file first."}',
    });
  });

  it('turns a file over 6 MB away before it reaches the service', async () => {
    const { env, seen } = service();
    const file = new FormData();
    file.append('file', new Blob([new Uint8Array(6 * 1024 * 1024 + 1)]), 'resume.pdf');
    expect(await forwardToTools(tools('/api/resumes/extract', { method: 'POST', body: file }), env)).toEqual({
      status: 413,
      body: '{"code":"FILE_TOO_LARGE"}',
    });
    expect(seen).toEqual([]);
  });

  it('calls the service unavailable when the tunnel fails or something other than the service answers', async () => {
    const asleep = service(() => Promise.reject(new Error('Network connection lost.')));
    expect(await forwardToTools(tools('/api/boards'), asleep.env)).toEqual({
      status: 503,
      body: '{"code":"SERVICE_UNAVAILABLE"}',
    });
    const page = service(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(await forwardToTools(tools('/api/boards'), page.env)).toEqual({
      status: 502,
      body: '{"code":"SERVICE_UNAVAILABLE"}',
    });
  });
});
