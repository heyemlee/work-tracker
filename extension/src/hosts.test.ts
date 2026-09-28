import { describe, expect, it } from 'vitest';
import { JOB_BOARD_MATCHES, onJobBoard } from './hosts';

describe('job boards', () => {
  it('knows a job board by its domain, subdomains included', () => {
    expect(onJobBoard('https://www.linkedin.com/jobs/view/4012345678/')).toBe(true);
    expect(onJobBoard('https://smartapply.indeed.com/beta/indeedapply/form/resume')).toBe(true);
    expect(onJobBoard('https://jobright.ai/jobs/info/123')).toBe(true);
  });

  it('takes company sites and look-alike domains for what they are', () => {
    expect(onJobBoard('https://careers.acme.com/jobs/123')).toBe(false);
    expect(onJobBoard('https://notindeed.com/apply')).toBe(false);
    expect(onJobBoard(undefined)).toBe(false);
    expect(onJobBoard('not a link')).toBe(false);
  });

  it('gives the detect script a match pattern per board', () => {
    expect(JOB_BOARD_MATCHES).toContain('*://*.indeed.com/*');
  });
});
