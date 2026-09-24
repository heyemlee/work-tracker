import { useEffect, useMemo, type ReactNode } from 'react';
import { usePrefs } from '../state/prefs';
import { I18nContext, type I18n } from './context';
import { interpolate, messages } from './messages';

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = usePrefs((p) => p.locale);

  const value = useMemo<I18n>(
    () => ({ locale, t: (key, vars) => interpolate(messages[locale][key], vars) }),
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
