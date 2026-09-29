import { addDays, diffDays } from './dates';
import type { Application, Id, IsoDate } from './types';

/** Days an application can sit at Applied before it counts as no reply. */
export const NO_REPLY_DAYS = 30;

/**
 * No reply, as far as Outbox knows: still at Applied, not rejected, and sent at least 30 days ago. Worked out from
 * the dates and never stored, so a late reply only needs its stage changed.
 */
export function isNoReply(application: Application, today: IsoDate): boolean {
  return (
    application.stage === 'applied' &&
    !application.rejected &&
    diffDays(today, application.appliedAt) >= NO_REPLY_DAYS
  );
}

/** Got an OA or further. A rejection after the OA still counts: the application got past the screen. */
export function reachedOa(application: Application): boolean {
  return application.stage !== 'applied';
}

export interface Stats {
  today: number;
  /** Today and the six days before it, so Monday doesn't start from zero. */
  week: number;
  /** At OA and not rejected. */
  oa: number;
  /** Sent in the last 30 days, and how many of those reached an OA. */
  month: { sent: number; oa: number };
}

/** Counts applications (not jobs): one posting applied to from two accounts is two applications. */
export function computeStats(applications: readonly Application[], today: IsoDate): Stats {
  const weekStart = addDays(today, -6);
  const monthStart = addDays(today, -29);
  const stats: Stats = { today: 0, week: 0, oa: 0, month: { sent: 0, oa: 0 } };
  for (const app of applications) {
    const sent = app.appliedAt <= today;
    if (app.appliedAt === today) stats.today += 1;
    if (sent && app.appliedAt >= weekStart) stats.week += 1;
    if (!app.rejected && app.stage === 'oa') stats.oa += 1;
    if (sent && app.appliedAt >= monthStart) {
      stats.month.sent += 1;
      if (reachedOa(app)) stats.month.oa += 1;
    }
  }
  return stats;
}

/** Last 7 days, last 30 days, or everything. */
export type Range = 'week' | 'month' | 'all';
export const RANGES: readonly Range[] = ['week', 'month', 'all'];

/** The first day a range covers; null for everything. */
export function rangeStart(range: Range, today: IsoDate): IsoDate | null {
  if (range === 'all') return null;
  return addDays(today, range === 'week' ? -6 : -29);
}

/** The applications sent within a range. */
export function inRange(applications: readonly Application[], range: Range, today: IsoDate): Application[] {
  const start = rangeStart(range, today);
  return applications.filter((app) => app.appliedAt <= today && (start === null || app.appliedAt >= start));
}

export interface Funnel {
  sent: number;
  /** Reached an OA, an offer included. */
  oa: number;
  offer: number;
  /** Rejected before any OA. */
  rejected: number;
  /** At Applied for 30 days or more. */
  noReply: number;
  /** At Applied for less than 30 days: too early to tell. */
  waiting: number;
}

/** Where the applications stand. Every application lands in exactly one of oa, rejected, noReply and waiting. */
export function funnel(applications: readonly Application[], today: IsoDate): Funnel {
  const result: Funnel = { sent: 0, oa: 0, offer: 0, rejected: 0, noReply: 0, waiting: 0 };
  for (const app of applications) {
    result.sent += 1;
    if (reachedOa(app)) {
      result.oa += 1;
      if (app.stage === 'offer') result.offer += 1;
    } else if (app.rejected) result.rejected += 1;
    else if (isNoReply(app, today)) result.noReply += 1;
    else result.waiting += 1;
  }
  return result;
}

export interface Bucket {
  /** The bucket's first day. */
  start: IsoDate;
  /** Days it covers: 1, or 7 when the range is too long to show day by day. */
  days: number;
  count: number;
}

/** The longest span shown day by day; longer ones are shown week by week. */
export const MAX_DAILY_BUCKETS = 60;

/** Applications sent per day (per week for long spans), oldest first. The last bucket ends today. */
export function buckets(applications: readonly Application[], range: Range, today: IsoDate): Bucket[] {
  const sent = applications.filter((app) => app.appliedAt <= today);
  const earliest = sent.reduce<IsoDate>((min, app) => (app.appliedAt < min ? app.appliedAt : min), today);
  const start = rangeStart(range, today) ?? earliest;
  const span = diffDays(today, start) + 1;
  const days = span > MAX_DAILY_BUCKETS ? 7 : 1;
  const list: Bucket[] = [];
  for (let back = Math.ceil(span / days) - 1; back >= 0; back--) {
    const end = addDays(today, -back * days);
    list.push({ start: addDays(end, 1 - days), days, count: 0 });
  }
  const first = list[0]!.start;
  for (const app of sent) {
    if (app.appliedAt < first) continue;
    const bucket = list[Math.floor(diffDays(app.appliedAt, first) / days)];
    if (bucket) bucket.count += 1;
  }
  return list;
}

/** What applications can be grouped by. */
export type Dimension = 'resumeId' | 'accountId' | 'channelId';

export interface Share {
  /** The resume version, account or channel; null when none was recorded. */
  key: Id | null;
  sent: number;
  oa: number;
}

/** Applications and OAs per resume version, account or channel, most used first. */
export function breakdown(applications: readonly Application[], dimension: Dimension): Share[] {
  const shares = new Map<Id | null, Share>();
  for (const app of applications) {
    const key = app[dimension];
    const share = shares.get(key) ?? { key, sent: 0, oa: 0 };
    share.sent += 1;
    if (reachedOa(app)) share.oa += 1;
    shares.set(key, share);
  }
  return [...shares.values()].sort((a, b) => b.sent - a.sent);
}

/** Below this many applications a rate is too noisy to compare with another. */
export const SMALL_SAMPLE = 20;

/** A share as a percentage, or null when there's nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : (part / whole) * 100;
}
