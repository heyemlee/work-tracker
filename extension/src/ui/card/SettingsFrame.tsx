import { toBackground } from '../../messages';
import type { Translate } from '../i18n';
import { Framed } from './Framed';

/**
 * The settings, in a window over the page like the profile's. What's in the window is the extension's own page in a
 * frame (Framed.tsx): nothing typed there reaches the page underneath, and an API key belongs in the frame. A page
 * that won't take the frame gets the settings in a tab, as before: a tab is what the window is there to spare the
 * owner.
 */
export function SettingsFrame({ t, dark, onClose }: { t: Translate; dark: boolean; onClose: () => void }) {
  return (
    <Framed
      name="settings"
      page="/options.html"
      title={t('options')}
      dark={dark}
      ask={() => toBackground('settings:open', {})}
      onClose={onClose}
      onStuck={() => void toBackground('card:options', {}).catch(() => undefined)}
    />
  );
}
