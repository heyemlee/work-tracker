import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { toBackground } from '../../src/messages';
import { getSettings, outboxLanguageItem } from '../../src/storage';
import { resolveLanguage, translator } from '../../src/ui/i18n';
import { Preview } from './Preview';
import './preview.css';

const params = new URLSearchParams(location.hash.slice(1));
// The card says which side its window is on, by the page under it.
const dark = params.get('dark') === '1';
// A frame is clear only where its page and the window around it agree on light or dark.
document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
document.documentElement.classList.toggle('framed', window.top !== window.self);

// A resume is shown only to the card that asked for it: any site could put this page in a frame of its own, and
// without the card's ticket it's handed nothing to draw. Asked once, here: the asking spends the ticket.
const entered = toBackground('preview:enter', { ticket: params.get('ticket') ?? '' }).then(
  (reply) => reply ?? ('refused' as const),
  () => 'refused' as const,
);

// The settings say which language, or Outbox's; if they can't be read, the browser's does.
void Promise.all([getSettings(), outboxLanguageItem.getValue()])
  .then(
    ([{ language }, outbox]) => resolveLanguage(language, outbox),
    () => resolveLanguage('auto'),
  )
  .then((language) =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <Preview t={translator(language)} dark={dark} entered={entered} />
      </StrictMode>,
    ),
  );
