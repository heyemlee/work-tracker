import type { IsoDate, IsoDateTime } from './types';

const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar date of a moment. */
export function toIsoDate(date: Date): IsoDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseIsoDate(date: IsoDate): Date {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function localDateOf(timestamp: IsoDateTime): IsoDate {
  return toIsoDate(new Date(timestamp));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(date);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** Whole calendar days from `earlier` to `later`. Rounds so DST shifts don't produce off-by-one days. */
export function diffDays(later: IsoDate, earlier: IsoDate): number {
  return Math.round((parseIsoDate(later).getTime() - parseIsoDate(earlier).getTime()) / DAY_MS);
}

/** Weeks start on Monday. */
export function startOfWeek(date: IsoDate): IsoDate {
  const d = parseIsoDate(date);
  return addDays(date, -((d.getDay() + 6) % 7));
}

export type GroupKey = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | `month:${string}`;

/** Which list section a date belongs to. Future dates count as today. */
export function groupKeyFor(date: IsoDate, today: IsoDate): GroupKey {
  if (date >= today) return 'today';
  if (date === addDays(today, -1)) return 'yesterday';
  const weekStart = startOfWeek(today);
  if (date >= weekStart) return 'thisWeek';
  if (date >= addDays(weekStart, -7)) return 'lastWeek';
  return `month:${date.slice(0, 7)}`;
}
