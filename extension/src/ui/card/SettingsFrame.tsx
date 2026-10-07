import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { toBackground } from '../../messages';
import type { Translate } from '../i18n';

/**
 * How long the settings page has to draw in the frame before a tab of its own is opened instead. Long enough for a
 * busy machine and a service worker waking up: a tab is what the window is there to spare the owner.
 */
const WAIT = 6000;

/**
 * The settings, in a window over the page like the profile's. What's in the window is the extension's own page in a
 * frame: the page underneath can't read an API key typed there or press anything in it, which it could in the card's
 * own markup. A page that won't take the frame gets the settings in a tab, as before.
 */
export function SettingsFrame({ t, dark, onClose }: { t: Translate; dark: boolean; onClose: () => void }) {
  const [address, setAddress] = useState<string | null>(null);
  // The window opens on the side of light or dark the card was on then.
  const [side] = useState(dark);
  const frame = useRef<HTMLIFrameElement>(null);
  const closed = useRef(onClose);
  useEffect(() => {
    closed.current = onClose;
  });

  useEffect(() => {
    let shown = false;
    let gone = false;
    const inTab = () => {
      if (gone || shown) return;
      void toBackground('card:options', {}).catch(() => undefined);
      closed.current();
    };
    const listener = (message: { type?: string }) => {
      if (message.type === 'settings:shown') {
        shown = true;
        // Keys go to the settings from the start: Escape closes them.
        frame.current?.focus();
      }
      if (message.type === 'settings:close') closed.current();
      return undefined;
    };
    browser.runtime.onMessage.addListener(listener);
    toBackground('settings:open', {})
      .then((reply) => {
        if (gone) return;
        if (!reply) return inTab();
        const page = browser.runtime.getURL('/options.html');
        setAddress(`${page}#${new URLSearchParams({ ticket: reply.ticket, dark: side ? '1' : '0' })}`);
      })
      .catch(inTab);
    const timer = setTimeout(inTab, WAIT);
    return () => {
      gone = true;
      clearTimeout(timer);
      browser.runtime.onMessage.removeListener(listener);
    };
  }, [side]);

  return (
    <div
      className="scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        className={`sheet framed glass${side ? ' dark' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('options')}
      >
        {address && <iframe ref={frame} className="sheet-frame" title={t('options')} src={address} />}
      </div>
    </div>
  );
}
