import { defineContentScript } from 'wxt/utils/define-content-script';
import { startBridge } from '../src/content/bridge';
import { OUTBOX_MATCHES } from '../src/hosts';
import { toBackground } from '../src/messages';

/**
 * On Outbox itself. Reads the session token (a same-origin request, so the cookie goes along) and hands it to the
 * service worker, for when Chrome doesn't send the cookie with the extension's own requests. And answers Outbox's
 * pages: the profile asks it to read a resume with the owner's key, the setup guide how it's doing and to open its
 * settings.
 */
export default defineContentScript({
  matches: OUTBOX_MATCHES,
  runAt: 'document_idle',
  async main(ctx) {
    const stop = startBridge(window, {
      status: () => toBackground('bridge:status', {}),
      parse: (pdf, text) => toBackground('resume:parse', { pdf, text }),
      openOptions: () => toBackground('card:options', {}),
    });
    ctx.onInvalidated(stop);
    try {
      const response = await fetch('/api/auth/get-session', { credentials: 'same-origin' });
      const data = (response.ok ? await response.json() : null) as { session?: { token?: string } } | null;
      await toBackground('outbox:session', { token: data?.session?.token ?? null });
    } catch {
      // Signed out or offline: nothing to hand over.
    }
  },
});
