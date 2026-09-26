import { BUILTIN_CHANNELS } from './channels';
import { addDays, parseIsoDate, toIsoDate } from './dates';
import type {
  Account,
  Application,
  Company,
  Id,
  IsoDate,
  IsoDateTime,
  Job,
  ResumeVersion,
  Snapshot,
  TimelineEvent,
} from './types';

/** A snapshot plus the timelines behind it. */
export interface SampleData extends Snapshot {
  events: TimelineEvent[];
}

// Fictional companies only: sample data must never claim a real company rejected anyone.
const COMPANIES = [
  'Northwind AI',
  'Lumen Labs',
  'Parallax Systems',
  'Quanta Robotics',
  'Cobalt Pay',
  'Helix Health',
  'Arcadia Cloud',
  'Meridian Data',
  'Tessellate',
  'Orbital Commerce',
  'Kestrel Security',
  'Sable Analytics',
  'Nimbus Agents',
  'Foundry Works',
  'Vector Forge',
  'Aperture Logistics',
  'Cirrus Mobility',
  'Beacon Bio',
  'Granite Labs',
  'Polaris Health',
  'Evergreen Finance',
  'Keystone AI',
  'Summit Grid',
  'Ember Games',
  'Prism Security',
  'Ledgerly',
  'Waypoint Maps',
  'Quill Docs',
  'Relay Voice',
  'Monarch Pay',
  'Halcyon Compute',
  'Driftwood Data',
];

const TITLES = [
  'Software Engineer, Agents',
  'Software Engineer II, Backend',
  'AI Engineer',
  'Member of Technical Staff',
  'Full Stack Engineer',
  'Software Engineer, LLM Infrastructure',
  'Applied AI Engineer',
  'Backend Engineer, Payments',
  'Software Engineer, New Grad',
  'Forward Deployed Engineer',
  'ML Platform Engineer',
  'Software Engineer, Developer Tools',
  'Agent Infrastructure Engineer',
  'Product Engineer',
  'Software Engineer, Platform',
];

/** Days before today for each sample job: dense recent activity, a long tail behind it. */
const DAYS_AGO = [
  0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 6, 7, 7, 8, 8, 9, 9, 10, 11, 12, 14, 15, 16,
  18, 19, 21, 22, 24, 25, 27, 29, 33, 38,
];

const SAVED = new Set([2, 8, 15]);
const MULTI_ACCOUNT: Record<number, Id[]> = {
  1: ['acc_a', 'acc_b'],
  10: ['acc_a', 'acc_b'],
  24: ['acc_a', 'acc_b'],
  30: ['acc_a', 'acc_school'],
};

type Outcome = 'applied' | 'oa' | 'offer' | 'rejected' | 'rejected_after_oa';
/** `${jobIndex}:${applicationIndex}` → outcome, so the sample always shows every state. */
const FORCED: Record<string, Outcome> = {
  '16:0': 'oa',
  '24:0': 'rejected',
  '24:1': 'oa',
  '29:0': 'oa',
  '33:0': 'oa',
  '36:0': 'offer',
  '38:0': 'rejected_after_oa',
  '41:0': 'rejected',
};

const NOTES: Record<number, string> = {
  3: 'Referral from a former teammate — ping her after the OA.',
  10: 'Recruiter reached out on LinkedIn. Follow up Friday.',
  16: 'OA: 90 minutes, two graph problems. Due Sunday.',
  36: 'Team: agent platform. Offer call scheduled; ask about the start date.',
};

/** Deterministic PRNG so the sample data looks the same on every reset. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSampleData(now: Date): SampleData {
  const random = mulberry32(20260923);
  const today = toIsoDate(now);
  const created = new Date(now.getTime() - 60 * 86_400_000).toISOString();

  /** A timestamp on `date`, never later than now. `fallbackMinutes` keeps same-day items ordered. */
  const stamp = (date: IsoDate, minutesIntoDay: number, fallbackMinutes: number): IsoDateTime => {
    const d = parseIsoDate(date);
    d.setMinutes(minutesIntoDay);
    return (d > now ? new Date(now.getTime() - fallbackMinutes * 60_000) : d).toISOString();
  };
  const notAfterToday = (date: IsoDate) => (date > today ? today : date);

  const accounts: Account[] = [
    { id: 'acc_a', label: 'A', email: 'me.primary@example.com', color: 'blue', createdAt: created },
    { id: 'acc_b', label: 'B', email: 'me.alt@example.com', color: 'purple', createdAt: created },
    { id: 'acc_school', label: 'School', email: 'me@school.example.edu', color: 'teal', createdAt: created },
  ];
  const resumes: ResumeVersion[] = [
    { id: 'res_sde', name: 'SDE-v3', createdAt: created },
    { id: 'res_agent', name: 'Agent-v2', createdAt: created },
  ];

  const companies: Company[] = [];
  const jobs: Job[] = [];
  const applications: Application[] = [];
  const events: TimelineEvent[] = [];
  let seq = 0;
  const id = (prefix: string) => `${prefix}_s${(seq++).toString(36)}`;

  DAYS_AGO.forEach((daysAgo, index) => {
    const companyName = COMPANIES[index % COMPANIES.length] ?? 'Acme';
    let company = companies.find((c) => c.name === companyName);
    if (!company) {
      company = { id: id('co'), name: companyName, createdAt: created };
      companies.push(company);
    }

    const title = index % 9 === 5 ? null : (TITLES[(index * 7) % TITLES.length] ?? null);
    const date = addDays(today, -daysAgo);
    const jobCreated = stamp(date, 9 * 60 + Math.floor(random() * 13 * 60), (index + 1) * 11);
    const job: Job = {
      id: id('job'),
      companyId: company.id,
      title,
      notes: NOTES[index] ?? '',
      createdAt: jobCreated,
      updatedAt: jobCreated,
    };
    jobs.push(job);
    if (SAVED.has(index)) {
      events.push({
        id: id('evt'),
        jobId: job.id,
        applicationId: null,
        accountId: null,
        type: 'job_created',
        from: null,
        to: null,
        actor: 'user',
        at: jobCreated,
      });
      return;
    }

    const accountIds = MULTI_ACCOUNT[index] ?? [title?.includes('New Grad') ? 'acc_school' : 'acc_a'];
    const aiRole = /AI|Agent|LLM|ML/.test(title ?? '');
    accountIds.forEach((accountId, appIndex) => {
      const appliedAt = notAfterToday(addDays(date, appIndex * 2));
      const appCreated = appIndex === 0 ? jobCreated : stamp(appliedAt, 20 * 60, (index + 1) * 11 - 5);
      const roll = random();
      const channelId =
        roll < 0.55
          ? 'ch_company_site'
          : roll < 0.8
            ? 'ch_linkedin'
            : roll < 0.92
              ? 'ch_referral'
              : 'ch_recruiter';

      let outcome = FORCED[`${index}:${appIndex}`];
      if (!outcome) {
        const r = random();
        if (daysAgo < 3) outcome = 'applied';
        else if (daysAgo <= 10) outcome = r < 0.4 ? 'rejected' : 'applied';
        else outcome = r < 0.55 ? 'rejected' : r < 0.62 ? 'rejected_after_oa' : 'applied';
      }

      const app: Application = {
        id: id('app'),
        jobId: job.id,
        accountId,
        channelId,
        resumeId: aiRole ? 'res_agent' : 'res_sde',
        stage:
          outcome === 'oa' || outcome === 'rejected_after_oa'
            ? 'oa'
            : outcome === 'offer'
              ? 'offer'
              : 'applied',
        rejected: outcome === 'rejected' || outcome === 'rejected_after_oa',
        appliedAt,
        source: 'user',
        createdAt: appCreated,
        updatedAt: appCreated,
      };
      applications.push(app);

      const base = { jobId: job.id, applicationId: app.id, accountId, actor: 'user' as const };
      const later = (days: number, minutes: number) =>
        stamp(notAfterToday(addDays(appliedAt, days)), minutes, 1);
      events.push({ ...base, id: id('evt'), type: 'applied', from: null, to: 'applied', at: appCreated });
      if (app.stage !== 'applied') {
        events.push({
          ...base,
          id: id('evt'),
          type: 'stage_changed',
          from: 'applied',
          to: 'oa',
          at: later(3, 10 * 60 + 20),
        });
      }
      if (app.stage === 'offer') {
        events.push({
          ...base,
          id: id('evt'),
          type: 'stage_changed',
          from: 'oa',
          to: 'offer',
          at: later(12, 16 * 60 + 5),
        });
      }
      if (app.rejected) {
        events.push({
          ...base,
          id: id('evt'),
          type: 'rejected',
          from: app.stage,
          to: app.stage,
          at: later(app.stage === 'oa' ? 9 : 6, 11 * 60 + 40),
        });
      }
    });
  });

  return { accounts, resumes, channels: [...BUILTIN_CHANNELS], companies, jobs, applications, events };
}
