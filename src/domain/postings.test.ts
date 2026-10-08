import { describe, expect, it } from 'vitest';
import {
  cleanLink,
  companyFromSlug,
  displayLink,
  findJobByLink,
  findSamePosting,
  linkKey,
  parsePosting,
} from './postings';
import { buildRows } from './rows';
import { company, job, snapshot } from './testing';

describe('parsePosting', () => {
  it.each([
    ['https://job-boards.greenhouse.io/anthropic/jobs/4020305008', 'anthropic'],
    ['https://boards.greenhouse.io/embed/job_app?for=figma&token=5230541004', 'figma'],
    ['https://jobs.lever.co/scale-ai/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab', 'scale-ai'],
    ['https://jobs.ashbyhq.com/openai/2c4b6d8f-1111-2222-3333-444455556666', 'openai'],
    ['https://jobs.gem.com/11x-ai/am9icG9zdDr2DjIQ3bPcrRLp0z2TjYKi', '11x-ai'],
    ['https://jobs.smartrecruiters.com/Visa/744000081234567-software-engineer', 'Visa'],
    ['https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Santa-Clara/X_JR1', 'nvidia'],
    ['https://wd1.myworkdaysite.com/recruiting/snapchat/snap/job/Palo-Alto/X_R1', 'snapchat'],
    ['https://careers-acme.icims.com/jobs/1234/software-engineer/job', 'acme'],
    ['https://acme.notion.site/Founding-Engineer-1a2b3c4d5e6f', 'acme'],
    ['https://www.metacareers.com/jobs/1234567890/', 'meta'],
    ['https://amazon.jobs/en/jobs/2712345/software-development-engineer', 'amazon'],
    ['https://jobs.careers.microsoft.com/global/en/job/1771234', 'microsoft'],
    ['https://careers.acme.co.uk/roles/42', 'acme'],
    ['https://www.linkedin.com/jobs/view/4012345678/', null],
    ['https://boards.greenhouse.io/', null],
  ])('%s names %s', (url, slug) => {
    expect(parsePosting(url)?.companySlug).toBe(slug);
  });

  it('reads the title from a Workday link', () => {
    const posting = parsePosting(
      'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Software-Engineer--AI-Platform_JR2001234',
    );
    expect(posting?.title).toBe('Senior Software Engineer AI Platform');
    expect(parsePosting('https://jobs.lever.co/acme/1')?.title).toBeNull();
  });

  it('ignores text that is not a single web link', () => {
    expect(parsePosting('Stripe')).toBeNull();
    expect(parsePosting('stripe.com/jobs')).toBeNull();
    expect(parsePosting('https://a.com/x https://b.com/y')).toBeNull();
    expect(parsePosting('javascript:alert(1)')).toBeNull();
  });
});

describe('cleanLink', () => {
  it('drops the fragment and tracking parameters but keeps the ones that name the posting', () => {
    expect(cleanLink('https://acme.com/careers?gh_jid=123&gh_src=abc&utm_source=linkedin#apply')).toBe(
      'https://acme.com/careers?gh_jid=123',
    );
  });

  it('drops a bare question mark', () => {
    expect(cleanLink('https://job-boards.greenhouse.io/discord/jobs/8811574002?')).toBe(
      'https://job-boards.greenhouse.io/discord/jobs/8811574002',
    );
  });

  it('reduces a LinkedIn search to the posting it has open', () => {
    expect(cleanLink('https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678')).toBe(
      'https://www.linkedin.com/jobs/view/4012345678/',
    );
  });

  it('adds https to a bare domain and rejects anything that is not a web link', () => {
    expect(cleanLink(' jobs.lever.co/acme/1 ')).toBe('https://jobs.lever.co/acme/1');
    expect(cleanLink('mailto:jobs@acme.com')).toBeNull();
    expect(cleanLink('not a link')).toBeNull();
    expect(cleanLink('localhost')).toBeNull();
  });
});

describe('companyFromSlug', () => {
  const companies = [company('c1', 'Scale AI'), company('c2', 'OpenAI')];

  it('matches an existing company regardless of spacing, case and legal suffix', () => {
    expect(companyFromSlug('scale-ai', companies)).toBe('Scale AI');
    expect(companyFromSlug('scaleai', companies)).toBe('Scale AI');
    expect(companyFromSlug('openai-inc', companies)).toBe('OpenAI');
  });

  it('capitalizes each word of a new company', () => {
    expect(companyFromSlug('northwind-robotics', companies)).toBe('Northwind Robotics');
  });
});

const rows = buildRows(
  snapshot({
    companies: [company('c1', 'Acme')],
    jobs: [{ ...job('j1', 'c1', 'SWE'), url: 'https://jobs.lever.co/acme/1' }, job('j2', 'c1', 'PM')],
  }),
);

describe('findJobByLink', () => {
  it('finds the job whatever the scheme, www, trailing slash or tracking', () => {
    expect(findJobByLink(rows, 'http://www.jobs.lever.co/acme/1/?lever-source=LinkedIn')?.job.id).toBe('j1');
    expect(findJobByLink(rows, 'https://jobs.lever.co/acme/2')).toBeUndefined();
  });

  it('treats parameter order as irrelevant', () => {
    expect(linkKey('https://a.com/j?b=2&a=1')).toBe(linkKey('https://a.com/j?a=1&b=2'));
  });
});

describe('findSamePosting', () => {
  it('matches company and title when either side has no link', () => {
    expect(findSamePosting(rows, 'Acme', 'SWE', null)?.job.id).toBe('j1');
    expect(findSamePosting(rows, 'acme', 'PM', 'https://jobs.lever.co/acme/2')?.job.id).toBe('j2');
  });

  it('keeps two postings with the same title apart when their links differ', () => {
    expect(findSamePosting(rows, 'Acme', 'SWE', 'https://jobs.lever.co/acme/2')).toBeUndefined();
    expect(findSamePosting(rows, 'Acme', 'SWE', 'https://jobs.lever.co/acme/1/')?.job.id).toBe('j1');
  });
});

describe('displayLink', () => {
  it('shows the link without scheme or www', () => {
    expect(displayLink('https://www.acme.com/careers/42/')).toBe('acme.com/careers/42');
    expect(displayLink('https://jobs.lever.co/')).toBe('jobs.lever.co');
  });
});
