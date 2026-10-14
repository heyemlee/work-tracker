/**
 * Vite's built files, under /assets, named after their contents and kept by the browser for a day (public/_headers).
 * Workers Assets answers an address no file has with the app's page, for the SPA's routes, and that answer under
 * /assets got the day's header too: a deploy reaching one machine before another could hand a browser the page for
 * a script the new build asks for, and the browser kept that blank screen through reloads for the day. A name no
 * built file has is a 404 here, kept by no one.
 */
export async function assetOrNotFound(request: Request, assets: Fetcher): Promise<Response> {
  const response = await assets.fetch(request);
  if (!response.headers.get('content-type')?.startsWith('text/html')) return response;
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
