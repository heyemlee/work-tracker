import { defineContentScript } from 'wxt/utils/define-content-script';
import { startFrame } from '../src/content/start';
import { ATS_MATCHES } from '../src/hosts';

/** Applicant-tracking pages: runs in every frame; the top frame also shows the card. */
export default defineContentScript({
  matches: ATS_MATCHES,
  allFrames: true,
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  main: (ctx) => startFrame(ctx, false),
});
