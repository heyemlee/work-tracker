import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { toBackground } from '../../messages';
import { getSettings } from '../../storage';
import { resolveLanguage, translator } from '../i18n';
import { pageIsDark } from './scheme';
import { SettingsFrame } from './SettingsFrame';
import { mountInShadow } from './shadow';

let showing: Promise<void> | null = null;

/**
 * The settings in their window with no card under it, for Outbox's own page: asked for there ("Open extension
 * settings"), they open over it as they do over a page with the card, not in a tab. Settles once the window has
 * closed. Asked for again while it's open, it stays the one window.
 */
export function showSettings(ctx: ContentScriptContext): Promise<void> {
  showing ??= open(ctx).finally(() => {
    showing = null;
  });
  return showing;
}

async function open(ctx: ContentScriptContext): Promise<void> {
  const { language } = await getSettings();
  const t = translator(resolveLanguage(language));
  let closed = () => {};
  const closing = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const mounted = await mountInShadow(ctx, (remove) => (
    <SettingsFrame
      t={t}
      dark={pageIsDark()}
      onClose={() => {
        remove();
        closed();
      }}
    />
  ));
  // A page that takes none of the extension's markup still gets the settings: in their tab.
  if (!mounted) return toBackground('card:options', {});
  return closing;
}
