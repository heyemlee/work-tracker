/**
 * Applicant-tracking hosts where application forms live, and the job boards' pages that show a posting to log
 * (LinkedIn's, Indeed's). The content script runs in every frame on them.
 */
export const ATS_MATCHES = [
  '*://boards.greenhouse.io/*',
  '*://job-boards.greenhouse.io/*',
  '*://boards.eu.greenhouse.io/*',
  '*://job-boards.eu.greenhouse.io/*',
  '*://jobs.lever.co/*',
  '*://jobs.eu.lever.co/*',
  '*://jobs.ashbyhq.com/*',
  '*://jobs.gem.com/*',
  '*://*.myworkdayjobs.com/*',
  '*://*.myworkdaysite.com/*',
  '*://www.linkedin.com/jobs/*',
  // A job's own page, and the lists that show one beside them: a search, Indeed's home page, a company's jobs. And
  // Indeed Apply's steps, where the card stays the posting's to log it, filling nothing.
  '*://*.indeed.com/viewjob*',
  '*://*.indeed.com/jobs*',
  '*://*.indeed.com/q-*',
  '*://*.indeed.com/',
  '*://*.indeed.com/?*',
  '*://*.indeed.com/cmp/*',
  '*://smartapply.indeed.com/*',
  '*://*.icims.com/*',
  '*://jobs.smartrecruiters.com/*',
  '*://apply.workable.com/*',
  '*://jobs.jobvite.com/*',
];

/** Where Outbox runs. The content script on these pages hands the session token to the service worker. */
export const OUTBOX_MATCHES = ['https://tracker.haoyang.us/*', 'http://localhost:5180/*'];

/**
 * Job boards with apply flows of their own (LinkedIn's Easy Apply, Indeed Apply…) and sites that keep a resume on
 * file: the card never opens by itself there. The toolbar button still opens it.
 */
const JOB_BOARDS = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'dice.com',
  'monster.com',
  'simplyhired.com',
  'wellfound.com',
  'joinhandshake.com',
  'builtin.com',
  'hired.com',
  'welcometothejungle.com',
  'workatastartup.com',
  'jobright.ai',
  'simplify.jobs',
];

/** A pattern with `*.` matches the domain itself too. */
export const JOB_BOARD_MATCHES = JOB_BOARDS.map((domain) => `*://*.${domain}/*`);

export function onJobBoard(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return JOB_BOARDS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
