import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getSettings } from '../../src/storage';
import { resolveLanguage, translator } from '../../src/ui/i18n';
import { Bubble } from './Bubble';
import './bubble.css';

// The browser's own window, so the system's side of light and dark.
const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.style.colorScheme = dark ? 'dark' : 'light';

void getSettings().then((settings) =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Bubble t={translator(resolveLanguage(settings.language))} outboxUrl={settings.outboxUrl} dark={dark} />
    </StrictMode>,
  ),
);
