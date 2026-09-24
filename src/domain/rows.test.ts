import { describe, expect, it } from 'vitest';
import { buildRows, computeStats, countByFilter, filterRows, groupRows, searchRows } from './rows';
import { account, application, company, job, snapshot } from './testing';

const accounts = [account('a', 'A'), account('b', 'B')];

const data = snapshot({
  accounts,
  companies: [company('c1', 'Northwind AI'), company('c2', 'Lumen Labs'), company('c3', 'Cobalt Pay')],
  jobs: [
    job('j1', 'c1', 'Software Engineer, Agents'),
    job('j2', 'c2', 'AI Engineer'),
    job('j3', 'c3', null, '2026-09-22T18:00:00.000Z'),
  ],
  applications: [
    application('p1', 'j1', 'b', { appliedAt: '2026-09-20', stage: 'oa' }),
    application('p2', 'j1', 'a', { appliedAt: '2026-09-10' }),
    application('p3', 'j2', 'a', { appliedAt: '2026-09-23', rejected: true }),
  ],
});

describe('buildRows', () => {
  const rows = buildRows(data);

  it('orders rows by latest activity, newest first', () => {
    expect(rows.map((r) => r.job.id)).toEqual(['j2', 'j3', 'j1']);
  });

  it('orders applications like the account list', () => {
    const j1 = rows.find((r) => r.job.id === 'j1');
    expect(j1?.applications.map((a) => a.accountId)).toEqual(['a', 'b']);
  });

  it('uses the latest applied date, or the save date for saved jobs', () => {
    expect(rows.find((r) => r.job.id === 'j1')?.sortDate).toBe('2026-09-20');
    expect(rows.find((r) => r.job.id === 'j3')?.status).toBe('saved');
  });
});

describe('filtering', () => {
  const rows = buildRows(data);

  it('keeps fully rejected jobs out of stage filters', () => {
    expect(filterRows(rows, 'applied')).toEqual([]);
    expect(filterRows(rows, 'all')).toHaveLength(3);
  });

  it('counts each filter', () => {
    expect(countByFilter(rows)).toEqual({ all: 3, saved: 1, applied: 0, oa: 1, offer: 0 });
  });

  it('searches company, title and account labels', () => {
    const q = (query: string) =>
      searchRows(rows, { query, hideRejected: false, accounts }).map((r) => r.job.id);
    expect(q('lumen')).toEqual(['j2']);
    expect(q('agents')).toEqual(['j1']);
    expect(q('b@example')).toEqual(['j1']);
  });

  it('hides rejected jobs on request', () => {
    const visible = searchRows(rows, { query: '', hideRejected: true, accounts });
    expect(visible.map((r) => r.job.id)).toEqual(['j3', 'j1']);
  });
});

describe('groupRows', () => {
  it('sections rows by date without reordering them', () => {
    const groups = groupRows(buildRows(data), '2026-09-23');
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.job.id)])).toEqual([
      ['today', ['j2']],
      ['yesterday', ['j3']],
      ['lastWeek', ['j1']],
    ]);
  });
});

describe('computeStats', () => {
  it('counts applications, not jobs', () => {
    expect(computeStats(data.applications, '2026-09-23')).toEqual({ today: 1, week: 1, oa: 1, offer: 0 });
  });
});
