import { useEffect } from 'react';
import { usePrefs, type ThemePref } from '../state/prefs';
import { useMediaQuery } from './useMediaQuery';

/** Mirrors the theme preference and visual tweaks onto <html>, where the CSS tokens read them. */
export function useThemeSync(): Exclude<ThemePref, 'system'> {
  const theme = usePrefs((p) => p.theme);
  const tweaks = usePrefs((p) => p.tweaks);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    // The browser's own bars take the page's color: index.html's tags only know the system's light and dark.
    const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim();
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', canvas);
    }
    root.dataset.accent = tweaks.accent;
    root.style.setProperty('--glass-blur', `${tweaks.blur}px`);
    root.style.setProperty('--glass-k', String(tweaks.tint));
    root.style.setProperty('--glow', String(tweaks.glow));
  }, [resolved, tweaks]);

  return resolved;
}
