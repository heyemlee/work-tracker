import { createContext, useContext } from 'react';
import type { Channel } from '../domain/types';
import type { Locale } from '../state/prefs';
import type { MessageKey } from './messages';

export interface I18n {
  locale: Locale;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) throw new Error('useI18n must be used inside <I18nProvider>');
  return i18n;
}

/** Built-in channels store a stable key; user channels store their own name. */
export function channelName(channel: Channel, t: I18n['t']): string {
  return channel.builtin ? t(`channel.${channel.name}` as MessageKey) : channel.name;
}
