import { defineContentScript } from 'wxt/utils/define-content-script';
import { startFrame } from '../src/content/start';

/**
 * Injected by the service worker: into a frame showing an application form and into the top frame, for the card, or
 * into every frame of any page when the toolbar button is pressed. Never into a frame already running it.
 */
export default defineContentScript({
  registration: 'runtime',
  cssInjectionMode: 'ui',
  main: (ctx) => startFrame(ctx, true),
});
