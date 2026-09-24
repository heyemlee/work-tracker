/**
 * The error code Better Auth redirected back with after a failed sign-in, if any. Read once at startup and
 * removed from the address bar so a reload doesn't show it again.
 */
export const initialAuthError: string | null = (() => {
  const url = new URL(window.location.href);
  const error = url.searchParams.get('error');
  if (error) {
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    window.history.replaceState(null, '', url);
  }
  return error;
})();

/** Starts Google sign-in: Better Auth answers with the provider URL to send the browser to. */
export async function signInWithGoogle(): Promise<void> {
  const response = await fetch('/api/auth/sign-in/social', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google', callbackURL: '/', errorCallbackURL: '/' }),
  });
  const { url } = (response.ok ? await response.json() : {}) as { url?: string };
  if (!url) throw new Error(`Sign-in failed with status ${response.status}`);
  window.location.assign(url);
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/sign-out', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  window.location.assign('/');
}
