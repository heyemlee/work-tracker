/** Applicant-tracking hosts where application forms live. The content script runs in every frame on them. */
export const ATS_MATCHES = [
  '*://boards.greenhouse.io/*',
  '*://job-boards.greenhouse.io/*',
  '*://boards.eu.greenhouse.io/*',
  '*://job-boards.eu.greenhouse.io/*',
  '*://jobs.lever.co/*',
  '*://jobs.eu.lever.co/*',
  '*://jobs.ashbyhq.com/*',
  '*://*.myworkdayjobs.com/*',
  '*://*.myworkdaysite.com/*',
  '*://www.linkedin.com/jobs/*',
];

/** Where Outbox runs. The content script on these pages hands the session token to the service worker. */
export const OUTBOX_MATCHES = ['https://tracker.haoyang.us/*', 'http://localhost:5180/*'];
