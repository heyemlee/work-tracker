import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain JavaScript build script, imported here to keep its key in step with the extension's.
import { employerKey as scriptKey } from '../../scripts/build-h1b.mjs';
import { employerKey, findEmployer, type H1bTable } from './h1b';
import { minimumYears, scanPosting } from './scan';

const codes = (text: string, title: string | null = 'Software Engineer', years = 2) =>
  scanPosting(text, title, years).map((signal) => `${signal.level}:${signal.code}`);

describe('scanPosting', () => {
  it.each([
    ['Applicants must be a U.S. citizen due to contract requirements.', 'red:citizenship'],
    ['This role requires an active TS/SCI clearance with polygraph.', 'red:clearance'],
    ['Candidates must be U.S. persons as defined by ITAR.', 'red:usPerson'],
    ['We are unable to sponsor visas for this position.', 'red:noSponsorship'],
    ['Sponsorship is not available for this role.', 'red:noSponsorship'],
    [
      'Must be authorized to work in the US without the need for current or future sponsorship.',
      'red:noSponsorship',
    ],
    ['Visa sponsorship is available for qualified candidates.', 'green:sponsors'],
    ['This is a new grad role for the class of 2026.', 'green:newGrad'],
  ])('%s', (text, expected) => {
    expect(codes(text)).toContain(expected);
  });

  it('keeps a no-sponsorship posting red even when it also mentions sponsorship', () => {
    const signals = codes(
      'We do not provide visa sponsorship. Sponsorship available for internal transfers only.',
    );
    expect(signals).toContain('red:noSponsorship');
    expect(signals).not.toContain('green:sponsors');
  });

  it('flags senior titles and years well beyond the applicant', () => {
    expect(codes('5+ years of experience building backend services.', 'Senior Software Engineer')).toEqual([
      'yellow:seniorTitle',
      'yellow:years',
    ]);
    expect(codes('3+ years of experience with Python.')).toEqual([]);
  });

  it('reads the fewest years a posting asks for', () => {
    expect(
      minimumYears('You have 5+ years of professional experience, or 3 years of experience with a PhD.'),
    ).toBe(3);
    expect(minimumYears('Experience with Go is a plus.')).toBeNull();
  });

  it('stays quiet about ordinary postings', () => {
    expect(codes('We build developer tools. You will design APIs and work with product teams.')).toEqual([]);
  });
});

describe('H-1B lookup', () => {
  const table: H1bTable = {
    years: [2021, 2022, 2023],
    employers: {
      stripe: [664, 'STRIPE INC'],
      'meta platforms': [7891, 'META PLATFORMS INC'],
      'meta payments': [12, 'META PAYMENTS INC'],
      'scale ai': [37, 'SCALE AI INC'],
    },
  };

  it('matches the filed entity behind a brand name', () => {
    expect(findEmployer(table, 'Stripe, Inc.')?.approvals).toBe(664);
    expect(findEmployer(table, 'Meta')?.employer).toBe('META PLATFORMS INC');
    expect(findEmployer(table, 'Scale AI')?.approvals).toBe(37);
    expect(findEmployer(table, 'Unknown Startup')).toBeNull();
  });

  it('keys employers the same way as the build script', () => {
    for (const name of [
      'STRIPE INC',
      'Stripe, Inc.',
      'META PLATFORMS INC',
      'Mil-Techs Inc',
      'ANTHROPIC PBC',
      'Crème Labs LLC',
      'Amazon.com Services LLC',
      'L L C Group Holdings',
    ]) {
      expect(scriptKey(name)).toBe(employerKey(name));
    }
  });
});
