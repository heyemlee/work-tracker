import { defineContentScript } from 'wxt/utils/define-content-script';
import { startContent } from '../src/content/main';
import { ATS_MATCHES } from '../src/hosts';
import { mountCard } from '../src/ui/card/mount';

/** Applicant-tracking pages: runs in every frame; the top frame also shows the card. */
export default defineContentScript({
  matches: ATS_MATCHES,
  allFrames: true,
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    startContent();
    if (window === window.top) await mountCard(ctx, false);
  },
});
