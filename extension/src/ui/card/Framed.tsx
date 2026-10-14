import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';

/**
 * How long a page has to draw in the frame before the window gives up on it. Long enough for a busy machine and a
 * service worker waking up.
 */
const WAIT = 6000;

/** The framed page's address: its ticket, and the side of light or dark it opens on. */
const addressFor = (page: string, ticket: string, dark: boolean) =>
  `${browser.runtime.getURL(page as '/options.html')}#${new URLSearchParams({ ticket, dark: dark ? '1' : '0' })}`;

/** How long a framed page has to keep what was typed in it once told the window is closing, before it goes. */
const LEAVING = 120;

/**
 * One of the extension's own pages in a window over the page, like the profile's: the settings, a resume's preview.
 * What's in the window is that page in a frame. The page underneath reaches nothing in a frame of the extension's
 * own origin, while the card's own markup, closed as its shadow root is, still passes it the keys typed there
 * (docs/autofill.md, "What the page can reach"). The framed page draws on a ticket the service worker gives out for
 * it (background/tickets.ts), says when it shows (`<name>:shown`) and asks to be closed (`<name>:close`).
 */
export function Framed({
  name,
  page,
  title,
  dark,
  tall = false,
  ask,
  onClose,
  onStuck,
}: {
  name: 'settings' | 'preview';
  page: '/options.html' | '/preview.html';
  title: string;
  dark: boolean;
  /** As tall as the browser's window lets it be: for a document, read from its top down. */
  tall?: boolean;
  /** Asks the service worker for the ticket the page draws on. */
  ask: () => Promise<{ ticket: string } | undefined>;
  onClose: () => void;
  /** The page didn't come to draw in the frame: what to do about it, before the window closes. */
  onStuck: () => void;
}) {
  const [address, setAddress] = useState<string | null>(null);
  // The window opens on the side of light or dark the card was on then.
  const [side] = useState(dark);
  const sheet = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // What the window was handed, as of now: it asks for its page once.
  const hands = useRef({ ask, onClose, onStuck });
  useEffect(() => {
    hands.current = { ask, onClose, onStuck };
  });

  useEffect(() => {
    let shown = false;
    let gone = false;
    const stuck = () => {
      if (gone || shown) return;
      hands.current.onStuck();
      hands.current.onClose();
    };
    const listener = (message: { type?: string }) => {
      if (message.type === `${name}:shown`) {
        shown = true;
        // Keys go to the framed page from the start: Escape closes it.
        frame.current?.focus();
      }
      if (message.type === `${name}:close`) hands.current.onClose();
      return undefined;
    };
    browser.runtime.onMessage.addListener(listener);
    // Until the page is there to take them, keys go to the window: Escape closes it then too.
    sheet.current?.focus({ preventScroll: true });
    hands.current
      .ask()
      .then((reply) => {
        if (gone) return;
        if (!reply) return stuck();
        setAddress(addressFor(page, reply.ticket, side));
      })
      .catch(stuck);
    const timer = setTimeout(stuck, WAIT);
    return () => {
      gone = true;
      clearTimeout(timer);
      browser.runtime.onMessage.removeListener(listener);
    };
  }, [name, page, side]);

  // Closed from out here, the page in the frame is told first, and has a moment to keep what was typed into it but
  // not yet kept (the settings keep a field as it's left, which a frame taken away never is).
  const leave = () => {
    frame.current?.contentWindow?.postMessage(
      { type: `${name}:closing` },
      new URL(browser.runtime.getURL('/')).origin,
    );
    setTimeout(() => hands.current.onClose(), frame.current ? LEAVING : 0);
  };

  // A frame put back into the page (a page that builds its document anew takes the card out and the card goes back
  // in) loads its address again, on a ticket spent the first time: the page asks for another, and draws on that.
  const loaded = useRef<string | null>(null);
  const onLoad = () => {
    if (loaded.current !== address) {
      loaded.current = address;
      return;
    }
    void hands.current
      .ask()
      .then((reply) => reply && setAddress(addressFor(page, reply.ticket, side)))
      .catch(() => undefined);
  };

  return (
    <div
      className="scrim"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        // The press closes the window and nothing more: the keyboard stays where closing puts it.
        event.preventDefault();
        leave();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') leave();
      }}
    >
      <div
        ref={sheet}
        className={`sheet framed glass${tall ? ' tall' : ''}${side ? ' dark' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        {address && (
          <iframe ref={frame} className="sheet-frame" title={title} src={address} onLoad={onLoad} />
        )}
      </div>
    </div>
  );
}
