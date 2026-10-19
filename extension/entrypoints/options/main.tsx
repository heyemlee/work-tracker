import { EXTENSION_SECTIONS } from '@domain/bridge';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { toBackground } from '../../src/messages';
import { resolveLanguage } from '../../src/ui/i18n';
import { App } from './App';
import { strings } from './strings';
import './options.css';

// In the card's window over a page, in Outbox's own settings window, or in a tab of its own.
const framed = window.top !== window.self;
const params = new URLSearchParams(location.hash.slice(1));
// Outbox's window has the sections down its own side: in its frame, the one it asks for, and nothing around it.
const embedded = framed && params.get('embed') === '1';
const section = EXTENSION_SECTIONS.find((name) => name === params.get('section')) ?? 'connection';
// The window says which side it's on, by the page under it or Outbox's theme; a tab follows the system.
const dark = framed ? params.get('dark') === '1' : window.matchMedia('(prefers-color-scheme: dark)').matches;
// A frame is clear only where its page and the window around it agree on light or dark.
document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
document.documentElement.classList.toggle('framed', framed);
document.documentElement.classList.toggle('embedded', embedded);

async function start(): Promise<void> {
  // Framed, the settings draw only for the card that asked for them: any site could put this page in a frame of
  // its own and lay something over it to borrow a click.
  const allowed =
    !framed ||
    (await toBackground('settings:enter', { ticket: params.get('ticket') ?? '' }).catch(() => false));
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {allowed ? (
        <App framed={framed} embedded={embedded} section={section} dark={dark} />
      ) : (
        <p className="refused">{strings(resolveLanguage('auto'))('notHere')}</p>
      )}
    </StrictMode>,
  );
}

void start();
