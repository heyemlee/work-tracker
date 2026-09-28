import { defineContentScript } from 'wxt/utils/define-content-script';
import { toBackground } from '../src/messages';
import { OUTBOX_MATCHES } from '../src/hosts';

/**
 * On Outbox itself: reads the session token (a same-origin request, so the cookie goes along) and hands it to the
 * service worker, for when Chrome doesn't send the cookie with the extension's own requests.
 */
export default defineContentScript({
  matches: OUTBOX_MATCHES,
  runAt: 'document_idle',
  async main() {
    try {
      const response = await fetch('/api/auth/get-session', { credentials: 'same-origin' });
      const data = (response.ok ? await response.json() : null) as { session?: { token?: string } } | null;
      await toBackground('outbox:session', { token: data?.session?.token ?? null });
    } catch {
      // Signed out or offline: nothing to hand over.
    }
  },
});
