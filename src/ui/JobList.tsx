import clsx from 'clsx';
import { Bookmark, ChevronRight } from 'lucide-react';
import { memo, useMemo } from 'react';
import { indexBy } from '../domain/collections';
import { diffDays, type GroupKey } from '../domain/dates';
import { isNoReply } from '../domain/insights';
import type { JobRow, RowGroup } from '../domain/rows';
import type { Account, Id, IsoDate } from '../domain/types';
import { useI18n, type I18n } from '../i18n/context';
import { formatMonth, formatTime } from '../i18n/format';
import { ApplicationChip } from './ApplicationChip';

function groupLabel(key: GroupKey, today: IsoDate, { t, locale }: I18n): string {
  switch (key) {
    case 'today':
      return t('group.today');
    case 'yesterday':
      return t('group.yesterday');
    case 'thisWeek':
      return t('group.thisWeek');
    case 'lastWeek':
      return t('group.lastWeek');
    default:
      return formatMonth(key.slice('month:'.length), today, locale);
  }
}

interface JobListProps {
  groups: RowGroup[];
  accounts: Account[];
  today: IsoDate;
  selectedId: Id | null;
  onSelect: (id: Id) => void;
}

export function JobList({ groups, accounts, today, selectedId, onSelect }: JobListProps) {
  const i18n = useI18n();
  const accountsById = useMemo(() => indexBy(accounts, (a) => a.id), [accounts]);

  return (
    <div className="space-y-7">
      {groups.map((group) => {
        const label = groupLabel(group.key, today, i18n);
        return (
          <section key={group.key} aria-label={label}>
            <h2 className="mb-2 flex items-baseline gap-2 px-1 text-[13px] font-semibold text-fg-2">
              {label}
              <span className="font-normal text-fg-3 tabular-nums">{group.rows.length}</span>
            </h2>
            <div className="card overflow-hidden">
              {group.rows.map((row, index) => (
                <JobRowItem
                  key={row.job.id}
                  row={row}
                  accountsById={accountsById}
                  today={today}
                  first={index === 0}
                  selected={row.job.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

interface JobRowItemProps {
  row: JobRow;
  accountsById: Map<Id, Account>;
  today: IsoDate;
  first: boolean;
  selected: boolean;
  onSelect: (id: Id) => void;
}

const JobRowItem = memo(function JobRowItem({
  row,
  accountsById,
  today,
  first,
  selected,
  onSelect,
}: JobRowItemProps) {
  const { t, locale } = useI18n();
  const open = () => onSelect(row.job.id);
  // Today's rows show the time; older rows show how long they have been waiting.
  const meta =
    row.sortDate >= today
      ? formatTime(row.sortTime, locale)
      : t('age.days', { n: diffDays(today, row.sortDate) });
  const live = row.applications.filter((application) => !application.rejected);
  // Faded like a rejection when every live application has gone unanswered for 30 days.
  const quiet =
    row.rejected || (live.length > 0 && live.every((application) => isNoReply(application, today)));

  return (
    <div
      role="button"
      tabIndex={0}
      data-job-row=""
      aria-current={selected || undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        open();
      }}
      className={clsx(
        'job-row relative px-4 py-3 outline-offset-[-2px] transition-colors',
        selected ? 'bg-selected' : 'hover:bg-fill',
      )}
    >
      {!first && <span aria-hidden="true" className="absolute top-0 right-0 left-4 h-px bg-hairline" />}
      <span className={clsx('min-w-0 [grid-area:text]', quiet && 'opacity-50')}>
        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">
          {row.company.name}
        </span>
        {row.job.title && <span className="block truncate text-[13px] text-fg-2">{row.job.title}</span>}
      </span>
      <span className="flex flex-wrap gap-1.5 [grid-area:chips] sm:justify-end">
        {row.applications.length === 0 ? (
          <span className="chip" data-status="saved">
            <Bookmark className="size-3" aria-hidden="true" />
            {t('status.saved')}
          </span>
        ) : (
          row.applications.map((application) => {
            const account = accountsById.get(application.accountId);
            return account ? (
              <ApplicationChip
                key={application.id}
                application={application}
                account={account}
                noReply={isNoReply(application, today)}
              />
            ) : null;
          })
        )}
      </span>
      <span className="flex items-center gap-0.5 text-[12px] whitespace-nowrap text-fg-3 tabular-nums [grid-area:meta]">
        {meta}
        <ChevronRight className="size-4 opacity-60" aria-hidden="true" />
      </span>
    </div>
  );
});
