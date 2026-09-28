import { defineContentScript } from 'wxt/utils/define-content-script';
import { resumeForm } from '../src/content/adapters/generic';
import { watchForForm } from '../src/content/watch';
import { ATS_MATCHES, JOB_BOARD_MATCHES, OUTBOX_MATCHES } from '../src/hosts';
import { toBackground } from '../src/messages';

/**
 * Every other site, in every frame: small, and idle until the page shows an application form with a resume upload.
 * Then the service worker brings in the content script and opens the card. Applicant-tracking hosts run the full
 * script from the start; job boards' own apply flows and Outbox are left alone.
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  excludeMatches: [...ATS_MATCHES, ...OUTBOX_MATCHES, ...JOB_BOARD_MATCHES],
  allFrames: true,
  runAt: 'document_idle',
  main(ctx) {
    const stop = watchForForm(
      document,
      () => location.href,
      () => resumeForm(document) !== null,
      () => void toBackground('frame:form', {}).catch(() => undefined),
    );
    ctx.onInvalidated(stop);
  },
});
