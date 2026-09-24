import { parseIsoDate } from '../domain/dates';
import type { IsoDate, IsoDateTime } from '../domain/types';
import type { Locale } from '../state/prefs';

const tag = (locale: Locale) => (locale === 'zh' ? 'zh-CN' : 'en-US');

const cache = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let fmt = cache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(tag(locale), options);
    cache.set(key, fmt);
  }
  return fmt;
}

/** "Sep 12" / "9月12日" */
export function formatShortDate(date: IsoDate, locale: Locale): string {
  return formatter(locale, { month: 'short', day: 'numeric' }).format(parseIsoDate(date));
}

/** "Wednesday, September 23" / "9月23日星期三" */
export function formatLongDate(date: IsoDate, locale: Locale): string {
  return formatter(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(parseIsoDate(date));
}

/** "3:42 PM" / "15:42" */
export function formatTime(timestamp: IsoDateTime, locale: Locale): string {
  return formatter(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp));
}

/** "Sep 12, 3:42 PM" / "9月12日 15:42" */
export function formatDateTime(timestamp: IsoDateTime, locale: Locale): string {
  return formatter(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
    new Date(timestamp),
  );
}

/** "August" within the current year, "August 2025" otherwise. */
export function formatMonth(yearMonth: string, today: IsoDate, locale: Locale): string {
  const date = parseIsoDate(`${yearMonth}-01`);
  const sameYear = yearMonth.slice(0, 4) === today.slice(0, 4);
  return formatter(locale, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' }).format(date);
}

export function formatCount(value: number, locale: Locale): string {
  return new Intl.NumberFormat(tag(locale), { notation: value >= 10_000 ? 'compact' : 'standard' }).format(
    value,
  );
}
