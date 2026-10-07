import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { RUNNING_FLAG, toBackground } from '../messages';
import { mountCard } from '../ui/card/mount';
import { adapterFor } from './adapters';
import { extractFields } from './extract';
import { startContent } from './main';
import { watchForForm } from './watch';

/**
 * Starts the content script in a frame, once: the manifest runs it on applicant-tracking hosts and the service
 * worker injects it elsewhere, and a frame may get both. The top frame also gets the card. On applicant-tracking
 * hosts the frame then watches for its form, which Workday draws only after the page has loaded, and has the card
 * open once the form is there. Other sites have the detect script for that.
 */
export async function startFrame(ctx: ContentScriptContext, startOpen: boolean): Promise<void> {
  const scope = window as unknown as Record<string, boolean>;
  if (scope[RUNNING_FLAG]) return;
  scope[RUNNING_FLAG] = true;
  // Reloading or updating the extension cuts this copy off from it, in a page that stays open. WXT notices when
  // asked, and then takes the card away and stops the watchers; without the flag, the toolbar button or the
  // shortcut brings in the new copy, with no need to load the page again.
  ctx.onInvalidated(() => {
    scope[RUNNING_FLAG] = false;
  });
  ctx.setInterval(() => undefined, 2000);
  ctx.onInvalidated(startContent());
  if (window === window.top) await mountCard(ctx, startOpen);
  const adapter = adapterFor(location.href);
  if (adapter.ats === 'generic') return;
  const stop = watchForForm(
    document,
    () => `${location.href}\n${adapter.step?.(document) ?? ''}`,
    // What the card will read: a form with fields in it, not just the page that will hold one.
    () => extractFields(adapter, document, 0).fields.length > 0,
    () => void toBackground('frame:form', {}).catch(() => undefined),
  );
  ctx.onInvalidated(stop);
}
