import clsx from 'clsx';
import { ChartColumn } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { indexBy } from '../domain/collections';
import {
  breakdown,
  buckets,
  funnel,
  inRange,
  percent,
  RANGES,
  SMALL_SAMPLE,
  type Bucket,
  type Dimension,
  type Range,
  type Share,
} from '../domain/insights';
import type { IsoDate, Snapshot } from '../domain/types';
import { useToday } from '../hooks/useToday';
import { accountName, channelName, useI18n } from '../i18n/context';
import { formatShortDate } from '../i18n/format';
import { usePrefs } from '../state/prefs';
import { SegmentedControl } from './SegmentedControl';

/** 12.3% under 10, 12% above: enough to compare without false precision. */
function formatRate(rate: number | null): string {
  if (rate === null) return '–';
  return `${rate.toFixed(rate > 0 && rate < 10 ? 1 : 0)}%`;
}

/** Which resume, account and channel get OAs, from what's already logged. Nothing here is stored. */
export function InsightsPage({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useI18n();
  const today = useToday();
  const goal = usePrefs((p) => p.dailyGoal);
  const [range, setRange] = useState<Range>('month');
  const applications = useMemo(
    () => inRange(snapshot.applications, range, today),
    [snapshot.applications, range, today],
  );
  const resumeName = useNamer(snapshot, 'resumeId');
  const accountLabel = useNamer(snapshot, 'accountId');
  const channelLabel = useNamer(snapshot, 'channelId');

  return (
    <main className="mx-auto w-full max-w-[1040px] px-4 pt-[100px] pb-32 sm:px-6 md:pb-24">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{t('insights.title')}</h1>
          <p className="mt-1 text-[14px] text-fg-2">{t('insights.hint')}</p>
        </div>
        <SegmentedControl<Range>
          label={t('insights.range')}
          layoutId="insights-range"
          segments={RANGES.map((value) => ({ value, label: t(`range.${value}`) }))}
          value={range}
          onChange={setRange}
        />
      </header>

      {snapshot.applications.length === 0 ? (
        <div className="py-20 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-fill">
            <ChartColumn className="size-6 text-fg-2" aria-hidden="true" />
          </div>
          <p className="mx-auto mt-4 max-w-[420px] text-[14px] text-fg-2">{t('insights.empty')}</p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <FunnelCard snapshot={snapshot} range={range} today={today} />
            <DailyCard snapshot={snapshot} range={range} today={today} goal={goal} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <BreakdownCard
              title={t('insights.byResume')}
              column={t('insights.colResume')}
              shares={breakdown(applications, 'resumeId')}
              name={resumeName}
            />
            <BreakdownCard
              title={t('insights.byAccount')}
              column={t('insights.colAccount')}
              shares={breakdown(applications, 'accountId')}
              name={accountLabel}
            />
            <BreakdownCard
              title={t('insights.byChannel')}
              column={t('insights.colChannel')}
              shares={breakdown(applications, 'channelId')}
              name={channelLabel}
            />
          </div>
        </>
      )}
    </main>
  );
}

/** Names a resume version, account or channel by its id; null is "none recorded". */
function useNamer(snapshot: Snapshot, dimension: Dimension): (key: string | null) => string {
  const { t } = useI18n();
  return useMemo(() => {
    if (dimension === 'resumeId') {
      const resumes = indexBy(snapshot.resumes, (r) => r.id);
      return (key) => (key && resumes.get(key)?.name) || t('insights.noResume');
    }
    if (dimension === 'accountId') {
      const accounts = indexBy(snapshot.accounts, (a) => a.id);
      return (key) => {
        const account = key ? accounts.get(key) : undefined;
        return account ? accountName(account, t) : t('account.noEmail');
      };
    }
    const channels = indexBy(snapshot.channels, (c) => c.id);
    return (key) => {
      const channel = key ? channels.get(key) : undefined;
      return channel ? channelName(channel, t) : t('insights.noChannel');
    };
  }, [snapshot, dimension, t]);
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card min-w-0 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function FunnelCard({ snapshot, range, today }: { snapshot: Snapshot; range: Range; today: IsoDate }) {
  const { t } = useI18n();
  const result = useMemo(
    () => funnel(inRange(snapshot.applications, range, today), today),
    [snapshot.applications, range, today],
  );
  const steps = [
    { key: 'sent', label: t('insights.sent'), value: result.sent, stage: 'applied' },
    { key: 'oa', label: t('insights.reachedOa'), value: result.oa, stage: 'oa' },
    { key: 'offer', label: t('insights.offer'), value: result.offer, stage: 'offer' },
  ] as const;

  return (
    <Card title={t('insights.funnel')}>
      <div className="mt-4 space-y-4">
        {steps.map((step) => {
          const rate = step.key === 'sent' ? null : percent(step.value, result.sent);
          const width = result.sent === 0 ? 0 : (step.value / result.sent) * 100;
          return (
            <div key={step.key}>
              <div className="flex items-baseline gap-2">
                <span className="flex items-center gap-1.5 text-[13px] text-fg-2">
                  <span className="dot" style={{ background: `var(--st-${step.stage})` }} />
                  {step.label}
                </span>
                <span className="ml-auto text-[20px] font-semibold tracking-[-0.02em] tabular-nums">
                  {step.value}
                </span>
                <span className="w-12 text-right text-[13px] text-fg-3 tabular-nums">
                  {rate === null ? '' : formatRate(rate)}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-[4px] bg-fill">
                <div
                  className="h-full rounded-[4px] bg-accent transition-[width] duration-500"
                  // A step with anything in it stays visible, however thin its share.
                  style={{ width: step.value > 0 ? `max(4px, ${width}%)` : 0 }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-[13px] text-fg-2">
        {t('insights.outcomes', {
          rejected: result.rejected,
          noReply: result.noReply,
          waiting: result.waiting,
        })}
      </p>
    </Card>
  );
}

function DailyCard({
  snapshot,
  range,
  today,
  goal,
}: {
  snapshot: Snapshot;
  range: Range;
  today: IsoDate;
  goal: number | null;
}) {
  const { t, locale } = useI18n();
  const [asTable, setAsTable] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const list = useMemo(
    () => buckets(snapshot.applications, range, today),
    [snapshot.applications, range, today],
  );
  const weekly = list[0]?.days === 7;
  // The daily goal only means something per day.
  const line = weekly ? null : goal;
  const total = list.reduce((sum, bucket) => sum + bucket.count, 0);
  const average = total / list.length;
  const top = Math.max(1, line ?? 0, ...list.map((bucket) => bucket.count)) * 1.12;
  const label = (bucket: Bucket) => formatShortDate(bucket.start, locale);
  const averageText = (Math.round(average * 10) / 10).toString();

  return (
    <Card
      title={weekly ? t('insights.perWeek') : t('insights.perDay')}
      aside={
        <>
          <span className="text-[13px] text-fg-2">
            {line === null
              ? t('insights.average', { n: averageText })
              : t('insights.averageGoal', { n: averageText, goal: line })}
          </span>
          <button
            type="button"
            onClick={() => setAsTable(!asTable)}
            className="ml-auto h-7 rounded-full bg-fill px-3 text-[12px] font-medium text-fg transition-colors hover:bg-fill-2"
          >
            {asTable ? t('insights.showChart') : t('insights.showTable')}
          </button>
        </>
      }
    >
      {asTable ? (
        <div className="mt-3 max-h-[220px] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-fg-3">
                <th scope="col" className="pb-2 font-medium">
                  {weekly ? t('insights.week') : t('insights.day')}
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  {t('insights.count')}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...list].reverse().map((bucket) => (
                <tr key={bucket.start} className="border-t border-hairline">
                  <th scope="row" className="py-1.5 text-left font-normal">
                    {label(bucket)}
                  </th>
                  <td className="py-1.5 text-right tabular-nums">{bucket.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-6">
          <div className="relative h-[160px]">
            {line !== null && (
              <div
                aria-hidden="true"
                className="absolute inset-x-0 border-t border-dashed border-fg-2/60"
                style={{ bottom: `${(line / top) * 100}%` }}
              >
                <span className="absolute -top-[18px] right-0 text-[11px] text-fg-2">
                  {t('insights.goalLine', { goal: line })}
                </span>
              </div>
            )}
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 border-t border-hairline" />
            <div
              role="img"
              aria-label={`${weekly ? t('insights.perWeek') : t('insights.perDay')}: ${list
                .map((bucket) => `${label(bucket)} ${bucket.count}`)
                .join(', ')}`}
              className="absolute inset-0 flex items-end justify-around gap-[3px]"
              onMouseLeave={() => setHovered(null)}
            >
              {list.map((bucket, index) => {
                const last = index === list.length - 1;
                return (
                  <div
                    key={bucket.start}
                    onMouseEnter={() => setHovered(index)}
                    className="relative flex h-full max-w-9 min-w-[3px] flex-1 items-end"
                  >
                    <div
                      className={clsx(
                        'w-full rounded-t-[4px] transition-[height,background-color] duration-300',
                        last || hovered === index ? 'bg-accent' : 'bg-fg/25',
                      )}
                      style={{ height: bucket.count > 0 ? `max(2px, ${(bucket.count / top) * 100}%)` : 0 }}
                    />
                    {hovered === index && (
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 rounded-[8px] bg-fg px-2 py-1 text-[12px] whitespace-nowrap text-canvas">
                        {t('insights.bar', { date: label(bucket), n: bucket.count })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div aria-hidden="true" className="mt-2 flex justify-between text-[11px] text-fg-3">
            <span>{label(list[0]!)}</span>
            {list.length > 2 && <span>{label(list[Math.floor(list.length / 2)]!)}</span>}
            <span>{label(list.at(-1)!)}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function BreakdownCard({
  title,
  column,
  shares,
  name,
}: {
  title: string;
  column: string;
  shares: Share[];
  name: (key: string | null) => string;
}) {
  const { t } = useI18n();
  const rates = shares.map((share) => percent(share.oa, share.sent) ?? 0);
  const best = Math.max(1, ...rates);
  const small = shares.some((share) => share.sent < SMALL_SAMPLE);

  return (
    <Card title={title}>
      <table className="mt-3 w-full table-fixed text-[13px]">
        <thead>
          <tr className="text-left text-[12px] text-fg-3">
            <th scope="col" className="pb-2 font-medium">
              {column}
            </th>
            <th scope="col" className="w-14 pb-2 text-right font-medium">
              {t('insights.colSent')}
            </th>
            <th scope="col" className="w-[42%] pb-2 pl-3 font-medium">
              {t('insights.colRate')}
            </th>
          </tr>
        </thead>
        <tbody>
          {shares.map((share, index) => {
            const rate = rates[index] ?? 0;
            const few = share.sent < SMALL_SAMPLE;
            return (
              <tr key={share.key ?? 'none'} className="border-t border-hairline">
                <th
                  scope="row"
                  className="truncate py-2.5 pr-2 text-left font-medium"
                  title={name(share.key)}
                >
                  {name(share.key)}
                </th>
                <td className="py-2.5 text-right text-fg-2 tabular-nums">{share.sent}</td>
                <td className="py-2.5 pl-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
                      <div
                        className={clsx('h-full rounded-full', few ? 'bg-fg/25' : 'bg-accent')}
                        style={{ width: `${(rate / best) * 100}%` }}
                      />
                    </div>
                    <span className={clsx('w-11 text-right font-semibold tabular-nums', few && 'text-fg-3')}>
                      {formatRate(rate)}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {small && <p className="mt-3 text-[12px] text-fg-3">{t('insights.small', { n: SMALL_SAMPLE })}</p>}
    </Card>
  );
}
