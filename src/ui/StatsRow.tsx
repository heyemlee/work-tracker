import type { ReactNode } from 'react';
import type { Stats } from '../domain/insights';
import type { IsoDate } from '../domain/types';
import { useI18n } from '../i18n/context';
import { formatCount, formatLongDate } from '../i18n/format';

/** The day's headline numbers. Values stay in primary ink; a status dot beside the label carries the color. */
export function StatsRow({ stats, today, goal }: { stats: Stats; today: IsoDate; goal: number | null }) {
  const { t, locale } = useI18n();

  return (
    <section>
      <p className="text-[13px] font-medium text-fg-2">{formatLongDate(today, locale)}</p>
      <dl className="mt-3 grid grid-cols-3 gap-x-6">
        <Stat label={t('stats.today')}>
          <Value>{formatCount(stats.today, locale)}</Value>
          {goal !== null && <span className="text-[15px] text-fg-3">/ {formatCount(goal, locale)}</span>}
          {goal !== null && (
            <span
              role="progressbar"
              aria-label={t('stats.goalProgress')}
              aria-valuenow={stats.today}
              aria-valuemin={0}
              aria-valuemax={goal}
              className="mt-2 block h-1 w-full max-w-[160px] basis-full overflow-hidden rounded-full bg-fill-2"
            >
              <span
                className="block h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${Math.min(100, (stats.today / Math.max(goal, 1)) * 100)}%` }}
              />
            </span>
          )}
        </Stat>
        <Stat label={t('stats.week')}>
          <Value>{formatCount(stats.week, locale)}</Value>
        </Stat>
        <Stat label={t('stats.oa')} dot="oa">
          <Value>{formatCount(stats.oa, locale)}</Value>
        </Stat>
      </dl>
    </section>
  );
}

function Stat({ label, dot, children }: { label: string; dot?: 'oa'; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 truncate text-[13px] text-fg-2">
        {dot && <span className="dot" style={{ background: `var(--st-${dot})` }} />}
        {label}
      </dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5">{children}</dd>
    </div>
  );
}

function Value({ children }: { children: ReactNode }) {
  return <span className="text-[34px] leading-[1.1] font-semibold tracking-[-0.025em]">{children}</span>;
}
