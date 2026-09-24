/** Starts Google sign-in: Better Auth answers with the provider URL to send the browser to. */
export async function signInWithGoogle(): Promise<void> {
  const response = await fetch('/api/auth/sign-in/social', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
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
