import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { toBackground } from '../../src/messages';
import { resolveLanguage } from '../../src/ui/i18n';
import { App } from './App';
import { strings } from './strings';
import './options.css';

// In the card's window over a page, or in a tab of its own.
const framed = window.top !== window.self;
const params = new URLSearchParams(location.hash.slice(1));
// The card says which side its window is on, by the page under it; a tab follows the system.
const dark = framed ? params.get('dark') === '1' : window.matchMedia('(prefers-color-scheme: dark)').matches;
// A frame is clear only where its page and the window around it agree on light or dark.
document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
document.documentElement.classList.toggle('framed', framed);

async function start(): Promise<void> {
  // Framed, the settings draw only for the card that asked for them: any site could put this page in a frame of
  // its own and lay something over it to borrow a click.
  const allowed =
    !framed ||
    (await toBackground('settings:enter', { ticket: params.get('ticket') ?? '' }).catch(() => false));
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {allowed ? (
        <App framed={framed} dark={dark} />
      ) : (
        <p className="refused">{strings(resolveLanguage('auto'))('notHere')}</p>
      )}
    </StrictMode>,
  );
}

void start();
