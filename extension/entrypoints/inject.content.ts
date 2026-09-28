import { defineContentScript } from 'wxt/utils/define-content-script';
import { startContent } from '../src/content/main';
import { mountCard } from '../src/ui/card/mount';

/**
 * Injected on demand: into the top frame of a career site that embeds an application form, or into every frame
 * of any page when the toolbar button is pressed.
 */
export default defineContentScript({
  registration: 'runtime',
  cssInjectionMode: 'ui',
  async main(ctx) {
    // Injecting twice (the button pressed again) must not start a second copy.
    const flag = '__outboxAutofill';
    const scope = window as unknown as Record<string, boolean>;
    if (scope[flag]) return;
    scope[flag] = true;
    startContent();
    if (window === window.top) await mountCard(ctx, true);
  },
});
