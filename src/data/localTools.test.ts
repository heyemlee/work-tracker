import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('local service client', () => {
  it('goes through the Worker with the session in a production build, never to localhost', async () => {
    vi.stubEnv('DEV', false);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ code: 'NOT_HOSTED' }, { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    const { localToolRequest } = await import('./localTools');
    await expect(localToolRequest('/api/boards')).rejects.toMatchObject({
      unavailable: true,
      message: 'NOT_HOSTED',
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/tools/api/boards',
      expect.objectContaining({ credentials: 'same-origin', headers: {} }),
    );
  });
  it('uses the separate same-origin prefix, omits main-site credentials and keeps FormData intact', async () => {
    vi.stubEnv('DEV', true);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: 'Example' }));
    vi.stubGlobal('fetch', fetcher);
    const { localToolRequest } = await import('./localTools');
    const file = new FormData();
    file.append('file', new Blob(['test']), 'test.pdf');
    await localToolRequest('/api/resumes/extract', 'POST', file);
    expect(fetcher).toHaveBeenCalledWith(
      '/local-tools/api/resumes/extract',
      expect.objectContaining({ credentials: 'omit', body: file, headers: { 'x-outbox-local': '1' } }),
    );
  });
  it('reports a stopped service or an HTML fallback as unavailable', async () => {
    vi.stubEnv('DEV', true);
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('<html>SPA</html>'));
    vi.stubGlobal('fetch', fetcher);
    const { localToolRequest } = await import('./localTools');
    await expect(localToolRequest('/api/boards')).rejects.toMatchObject({ unavailable: true });
    await expect(localToolRequest('/api/boards')).rejects.toMatchObject({ unavailable: true });
  });
  it('rejects malformed model facts before handing anything to the profile', async () => {
    vi.stubEnv('DEV', true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ facts: { education: 'invalid' } })));
    const { parseLocalResume } = await import('./localTools');
    await expect(parseLocalResume('Example', 'function-calling')).rejects.toThrow();
  });
});
