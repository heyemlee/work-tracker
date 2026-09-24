import { describe, expect, it } from 'vitest';
import { addDays, diffDays, groupKeyFor, startOfWeek } from './dates';

// 2026-09-23 is a Wednesday.
const TODAY = '2026-09-23';

describe('dates', () => {
  it('starts weeks on Monday', () => {
    expect(startOfWeek(TODAY)).toBe('2026-09-21');
    expect(startOfWeek('2026-09-21')).toBe('2026-09-21');
    expect(startOfWeek('2026-09-27')).toBe('2026-09-21');
  });

  it('adds and diffs calendar days across month boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(diffDays('2026-10-01', '2026-09-01')).toBe(30);
  });

  it('diffs across a daylight-saving change without drifting', () => {
    expect(diffDays('2026-11-02', '2026-10-31')).toBe(2);
  });

  it.each([
    ['2026-09-23', 'today'],
    ['2026-09-25', 'today'],
    ['2026-09-22', 'yesterday'],
    ['2026-09-21', 'thisWeek'],
    ['2026-09-20', 'lastWeek'],
    ['2026-09-14', 'lastWeek'],
    ['2026-09-13', 'month:2026-09'],
    ['2026-08-31', 'month:2026-08'],
  ])('groups %s as %s', (date, key) => {
    expect(groupKeyFor(date, TODAY)).toBe(key);
  });

  it('labels Sunday as yesterday on a Monday even though it belongs to last week', () => {
    expect(groupKeyFor('2026-09-20', '2026-09-21')).toBe('yesterday');
  });
});
