import { useEffect } from 'react';
import { usePrefs } from '../state/prefs';
import { useMediaQuery } from './useMediaQuery';

/** Mirrors the theme preference and visual tweaks onto <html>, where the CSS tokens read them. */
export function useThemeSync(): 'light' | 'dark' {
  const theme = usePrefs((p) => p.theme);
  const tweaks = usePrefs((p) => p.tweaks);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.accent = tweaks.accent;
    root.style.setProperty('--glass-blur', `${tweaks.blur}px`);
    root.style.setProperty('--glass-k', String(tweaks.tint));
    root.style.setProperty('--glow', String(tweaks.glow));
  }, [resolved, tweaks]);

  return resolved;
}
