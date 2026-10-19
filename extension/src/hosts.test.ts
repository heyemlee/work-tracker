import { describe, expect, it } from 'vitest';
import { ATS_MATCHES, JOB_BOARD_MATCHES, onJobBoard } from './hosts';

/**
 * Whether Chrome runs a content script with these patterns on a page: `*` stands for any run of characters (a `?`
 * for itself), `*.` before a host for it and its subdomains, and the path is matched together with its query.
 */
function runsOn(patterns: readonly string[], url: string): boolean {
  const page = new URL(url);
  return patterns.some((pattern) => {
    const [, scheme, host, path] = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern)!;
    if (scheme !== '*' && `${scheme}:` !== page.protocol) return false;
    const onHost = host!.startsWith('*.')
      ? page.hostname === host!.slice(2) || page.hostname.endsWith(host!.slice(1))
      : page.hostname === host;
    const wild = path!.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
    return onHost && new RegExp(`^${wild.join('.*')}$`).test(page.pathname + page.search);
  });
}

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

describe('Indeed', () => {
  it('runs the script from the start where a posting shows: its page, a search, the home page, a company’s jobs', () => {
    for (const url of [
      'https://www.indeed.com/viewjob?jk=5a2e49e6872d0c2b',
      'https://www.indeed.com/jobs?q=software+engineer&l=San+Jose%2C+CA&vjk=d501d1fd236f6dc3',
      'https://www.indeed.com/q-software-engineer-l-san-jose,-ca-jobs.html',
      'https://www.indeed.com/',
      'https://www.indeed.com/?vjk=d501d1fd236f6dc3',
      'https://www.indeed.com/cmp/Teradyne/jobs?jk=bc4aecf5372762d9',
      'https://ca.indeed.com/viewjob?jk=0123456789abcdef',
    ])
      expect(runsOn(ATS_MATCHES, url), url).toBe(true);
  });

  it('runs on Indeed Apply’s steps too, where the card stays the posting’s', () => {
    for (const url of [
      'https://smartapply.indeed.com/beta/indeedapply/applybyapplyablejobid?indeedApplyableJobId=bd71dcf1',
      'https://smartapply.indeed.com/beta/indeedapply/form/questions-module/questions/1',
      'https://smartapply.indeed.com/beta/indeedapply/form/review-module',
    ])
      expect(runsOn(ATS_MATCHES, url), url).toBe(true);
  });

  it('stays out of Indeed’s sign-in and the rest, until the toolbar button is pressed', () => {
    for (const url of [
      'https://secure.indeed.com/auth?continue=https%3A%2F%2Fwww.indeed.com%2Fjobs',
      'https://www.indeed.com/career-advice/finding-a-job/how-to-apply',
      'https://notindeed.com/viewjob?jk=0123456789abcdef',
    ])
      expect(runsOn(ATS_MATCHES, url), url).toBe(false);
    // And the script that watches other sites for a form leaves it out, among the job boards' pages.
    expect(runsOn(JOB_BOARD_MATCHES, 'https://smartapply.indeed.com/beta/indeedapply/form/resume')).toBe(
      true,
    );
  });
});
