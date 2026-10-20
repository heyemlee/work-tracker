/**
 * The routes of the Discover and Resume tools service that the app's pages call, by method. Vite's bridge in
 * development (scripts/localToolsProxy.ts) and the Worker's /api/tools (worker/tools.ts) pass these and nothing else:
 * never the service's own pages, files or other paths.
 */
export function localToolPath(method: string, path: string): boolean {
  if (method === 'GET')
    return /^\/(health|api\/(jobs(?:\/[\da-f-]{36})?|boards|sync|resumes\/status))$/.test(path);
  if (method === 'POST')
    return /^\/api\/(boards|sync|resumes\/(extract|parse|models|check-connection))$/.test(path);
  if (method === 'PATCH') return /^\/api\/boards\/[\da-f-]{36}$/.test(path);
  return ['PUT', 'DELETE'].includes(method) && path === '/api/resumes/settings';
}
