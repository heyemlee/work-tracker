import { describe, expect, it } from 'vitest';
import {
  breakdown,
  buckets,
  computeStats,
  funnel,
  inRange,
  isNoReply,
  percent,
  rangeStart,
  reachedOa,
} from './insights';
import { application } from './testing';

const TODAY = '2026-09-28';

describe('isNoReply', () => {
  it('counts an application still at Applied 30 days on', () => {
    expect(isNoReply(application('a', 'j', 'x', { appliedAt: '2026-08-29' }), TODAY)).toBe(true);
    expect(isNoReply(application('a', 'j', 'x', { appliedAt: '2026-08-30' }), TODAY)).toBe(false);
  });

  it('leaves out rejected applications and later stages', () => {
    const old = { appliedAt: '2026-07-01' };
    expect(isNoReply(application('a', 'j', 'x', { ...old, rejected: true }), TODAY)).toBe(false);
    expect(isNoReply(application('a', 'j', 'x', { ...old, stage: 'oa' }), TODAY)).toBe(false);
  });
});

describe('reachedOa', () => {
  it('counts an OA even when it ended in a rejection', () => {
    expect(reachedOa(application('a', 'j', 'x', { stage: 'oa', rejected: true }))).toBe(true);
    expect(reachedOa(application('a', 'j', 'x', { stage: 'offer' }))).toBe(true);
    expect(reachedOa(application('a', 'j', 'x'))).toBe(false);
  });
});

describe('computeStats', () => {
  const apps = [
    application('p1', 'j1', 'a', { appliedAt: TODAY }),
    application('p2', 'j1', 'b', { appliedAt: TODAY, stage: 'oa' }),
    application('p3', 'j2', 'a', { appliedAt: '2026-09-22' }),
    application('p4', 'j3', 'a', { appliedAt: '2026-09-21', stage: 'oa', rejected: true }),
    application('p5', 'j4', 'a', { appliedAt: '2026-08-30', stage: 'offer' }),
    application('p6', 'j5', 'a', { appliedAt: '2026-08-29', stage: 'oa' }),
  ];

  it('counts today, the last 7 days and live OAs', () => {
    expect(computeStats(apps, TODAY)).toEqual({ today: 2, week: 3, oa: 2 });
  });

  it('counts the last 7 days rather than the calendar week', () => {
    // 2026-09-28 is a Monday: a calendar week would hold only today's two.
    expect(computeStats(apps, TODAY).week).toBe(3);
  });
});

describe('ranges', () => {
  it('starts 7 and 30 days back, today included', () => {
    expect(rangeStart('week', TODAY)).toBe('2026-09-22');
    expect(rangeStart('month', TODAY)).toBe('2026-08-30');
    expect(rangeStart('all', TODAY)).toBeNull();
  });

  it('keeps the applications sent within the range', () => {
    const apps = [
      application('p1', 'j', 'a', { appliedAt: '2026-09-22' }),
      application('p2', 'j', 'b', { appliedAt: '2026-09-21' }),
    ];
    expect(inRange(apps, 'week', TODAY).map((a) => a.id)).toEqual(['p1']);
    expect(inRange(apps, 'all', TODAY)).toHaveLength(2);
  });
});

describe('funnel', () => {
  it('puts each application in exactly one outcome', () => {
    const apps = [
      application('p1', 'j', 'a', { appliedAt: TODAY }),
      application('p2', 'j', 'a', { appliedAt: '2026-08-01' }),
      application('p3', 'j', 'a', { appliedAt: '2026-08-01', rejected: true }),
      application('p4', 'j', 'a', { stage: 'oa', rejected: true }),
      application('p5', 'j', 'a', { stage: 'offer' }),
    ];
    expect(funnel(apps, TODAY)).toEqual({ sent: 5, oa: 2, offer: 1, rejected: 1, noReply: 1, waiting: 1 });
  });
});

describe('buckets', () => {
  it('counts per day over the range, ending today', () => {
    const apps = [
      application('p1', 'j', 'a', { appliedAt: TODAY }),
      application('p2', 'j', 'b', { appliedAt: TODAY }),
      application('p3', 'j', 'a', { appliedAt: '2026-09-22' }),
      application('p4', 'j', 'a', { appliedAt: '2026-09-21' }),
    ];
    const week = buckets(apps, 'week', TODAY);
    expect(week).toHaveLength(7);
    expect(week[0]).toEqual({ start: '2026-09-22', days: 1, count: 1 });
    expect(week.at(-1)).toEqual({ start: TODAY, days: 1, count: 2 });
  });

  it('starts everything at the first application', () => {
    const all = buckets([application('p1', 'j', 'a', { appliedAt: '2026-09-26' })], 'all', TODAY);
    expect(all.map((b) => b.count)).toEqual([1, 0, 0]);
  });

  it('switches to weeks when a span is too long for days', () => {
    const all = buckets([application('p1', 'j', 'a', { appliedAt: '2026-06-01' })], 'all', TODAY);
    expect(all.every((b) => b.days === 7)).toBe(true);
    expect(all.at(-1)?.start).toBe('2026-09-22');
    expect(all.reduce((sum, b) => sum + b.count, 0)).toBe(1);
  });

  it('has one empty day with no applications at all', () => {
    expect(buckets([], 'all', TODAY)).toEqual([{ start: TODAY, days: 1, count: 0 }]);
  });
});

describe('breakdown', () => {
  it('counts applications and OAs per resume, most used first', () => {
    const apps = [
      application('p1', 'j', 'a', { resumeId: 'sde' }),
      application('p2', 'j', 'a', { resumeId: 'agent', stage: 'oa' }),
      application('p3', 'j', 'a', { resumeId: 'agent' }),
      application('p4', 'j', 'a'),
    ];
    expect(breakdown(apps, 'resumeId')).toEqual([
      { key: 'agent', sent: 2, oa: 1 },
      { key: 'sde', sent: 1, oa: 0 },
      { key: null, sent: 1, oa: 0 },
    ]);
  });
});

describe('percent', () => {
  it("is null when there's nothing to divide by", () => {
    expect(percent(1, 4)).toBe(25);
    expect(percent(0, 0)).toBeNull();
  });
});
