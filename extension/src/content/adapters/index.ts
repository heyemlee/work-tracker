import { ashby } from './ashby';
import { gem } from './gem';
import { generic } from './generic';
import { greenhouse } from './greenhouse';
import { indeed } from './indeed';
import { lever } from './lever';
import { linkedin } from './linkedin';
import { icims } from './icims';
import { smartrecruiters } from './smartrecruiters';
import { workable } from './workable';
import { jobvite } from './jobvite';
import type { Adapter } from './types';
import { workday } from './workday';

const isUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function adapterFor(url: string): Adapter {
  const host = new URL(url).hostname;
  if (isUnder(host, 'greenhouse.io')) return greenhouse;
  if (isUnder(host, 'lever.co')) return lever;
  if (host === 'jobs.ashbyhq.com') return ashby;
  if (host === 'jobs.gem.com') return gem;
  if (isUnder(host, 'myworkdayjobs.com') || isUnder(host, 'myworkdaysite.com')) return workday;
  if (isUnder(host, 'linkedin.com')) return linkedin;
  if (isUnder(host, 'indeed.com')) return indeed;
  if (isUnder(host, 'icims.com')) return icims;
  if (host === 'jobs.smartrecruiters.com') return smartrecruiters;
  if (host === 'apply.workable.com') return workable;
  if (host === 'jobs.jobvite.com') return jobvite;
  return generic;
}

export type { Adapter } from './types';
