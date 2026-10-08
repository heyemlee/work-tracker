import { defineContentScript } from 'wxt/utils/define-content-script';
import { startBridge } from '../src/content/bridge';
import { OUTBOX_MATCHES } from '../src/hosts';
import { toBackground } from '../src/messages';
import { showSettings } from '../src/ui/card/settingsWindow';

/**
 * On Outbox itself. Reads the session token (a same-origin request, so the cookie goes along) and hands it to the
 * service worker, for when Chrome doesn't send the cookie with the extension's own requests. And answers Outbox's
 * pages: the profile asks it to read a resume with the owner's key, the setup guide how it's doing and for its
 * settings, which open in their window over Outbox's page.
 */
export default defineContentScript({
  matches: OUTBOX_MATCHES,
  runAt: 'document_idle',
  // The window's stylesheet is the card's, read into the window's shadow root as it opens.
  cssInjectionMode: 'ui',
  async main(ctx) {
    const stop = startBridge(window, {
      status: () => toBackground('bridge:status', {}),
      parse: (pdf, text) => toBackground('resume:parse', { pdf, text }),
      openOptions: () => showSettings(ctx),
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
