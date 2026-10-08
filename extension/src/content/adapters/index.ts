import { ashby } from './ashby';
import { gem } from './gem';
import { generic } from './generic';
import { greenhouse } from './greenhouse';
import { lever } from './lever';
import { linkedin } from './linkedin';
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
  return generic;
}

export type { Adapter } from './types';
