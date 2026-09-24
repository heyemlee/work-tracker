import clsx from 'clsx';
import type { Stats } from '../domain/rows';
import type { IsoDate } from '../domain/types';
import { useI18n } from '../i18n/context';
import { formatCount, formatLongDate } from '../i18n/format';

/** The day's headline numbers. Values stay in primary ink; a status dot beside the label carries the color. */
export function StatsRow({ stats, today, columns = 4 }: { stats: Stats; today: IsoDate; columns?: 2 | 4 }) {
  const { t, locale } = useI18n();
  const items = [
    { key: 'today', label: t('stats.today'), value: stats.today, status: null },
    { key: 'week', label: t('stats.week'), value: stats.week, status: null },
    { key: 'oa', label: t('stats.oa'), value: stats.oa, status: 'oa' },
    { key: 'offer', label: t('stats.offer'), value: stats.offer, status: 'offer' },
  ] as const;

  return (
    <section>
      <p className="text-[13px] font-medium text-fg-2">{formatLongDate(today, locale)}</p>
      <dl className={clsx('mt-3 grid grid-cols-2 gap-x-6 gap-y-5', columns === 4 && 'sm:grid-cols-4')}>
        {items.map((item) => (
          <div key={item.key} className="min-w-0">
            <dt className="flex items-center gap-1.5 truncate text-[13px] text-fg-2">
              {item.status && <span className="dot" style={{ background: `var(--st-${item.status})` }} />}
              {item.label}
            </dt>
            <dd className="mt-1 text-[34px] leading-[1.1] font-semibold tracking-[-0.025em]">
              {formatCount(item.value, locale)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
