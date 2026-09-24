import { describe, expect, it } from 'vitest';
import { findJob, normalizeCompanyName, suggestCompanies } from './companies';
import { buildRows } from './rows';
import { account, application, company, job, snapshot } from './testing';

describe('normalizeCompanyName', () => {
  it.each([
    ['Stripe, Inc.', 'stripe'],
    ['  Lumen   Labs ', 'lumen labs'],
    ['Café Robotics LLC', 'cafe robotics'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });
});

const data = snapshot({
  accounts: [account('a')],
  companies: [
    company('c1', 'Northwind AI'),
    company('c2', 'North Star Robotics'),
    company('c3', 'Cobalt Northway'),
    company('c4', 'Lumen Labs'),
  ],
  jobs: [job('j1', 'c1', 'Software Engineer, Agents'), job('j2', 'c1', null)],
  applications: [application('p1', 'j1', 'a')],
});
const rows = buildRows(data);

describe('suggestCompanies', () => {
  it('ranks prefix matches before word and substring matches', () => {
    const names = suggestCompanies('north', rows, data.companies).map((s) => s.company.name);
    expect(names).toEqual(['North Star Robotics', 'Northwind AI', 'Cobalt Northway']);
  });

  it('includes each company’s jobs', () => {
    const [northwind] = suggestCompanies('northwind', rows, data.companies);
    expect(northwind?.jobs.map((r) => r.job.id).sort()).toEqual(['j1', 'j2']);
  });

  it('returns nothing for an empty query', () => {
    expect(suggestCompanies('  ', rows, data.companies)).toEqual([]);
  });
});

describe('findJob', () => {
  it('matches the same company and title regardless of formatting', () => {
    expect(findJob(rows, 'northwind ai, inc.', 'software engineer agents')?.job.id).toBe('j1');
  });

  it('never matches an untitled entry', () => {
    expect(findJob(rows, 'Northwind AI', null)).toBeUndefined();
  });
});
