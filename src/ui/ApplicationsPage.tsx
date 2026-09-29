import { AtSign, Send } from 'lucide-react';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { computeStats } from '../domain/insights';
import { countByFilter, filterRows, groupRows, searchRows, type Filter, type JobRow } from '../domain/rows';
import type { Id, Snapshot } from '../domain/types';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useToday } from '../hooks/useToday';
import { useI18n } from '../i18n/context';
import { usePrefs } from '../state/prefs';
import { navigate, PAGE_PATHS } from '../state/router';
import { DetailPanel } from './DetailPanel';
import { JobList } from './JobList';
import { Button } from './primitives';
import { SetupChecklist } from './SetupChecklist';
import { StatsRow } from './StatsRow';
import { FilterControl } from './Toolbar';

/** Width the open inspector takes from the page on wide screens: panel + its margin. */
const PANEL_RESERVE = 444;

interface ApplicationsPageProps {
  snapshot: Snapshot;
  rows: JobRow[];
  query: string;
  selectedId: Id | null;
  onSelect: (id: Id | null) => void;
}

/** The home page: what's left to set up, today's numbers, and every job, newest first. */
export function ApplicationsPage({ snapshot, rows, query, selectedId, onSelect }: ApplicationsPageProps) {
  const { t } = useI18n();
  const today = useToday();
  const hideRejected = usePrefs((p) => p.hideRejected);
  const goal = usePrefs((p) => p.dailyGoal);
  const wide = useMediaQuery('(min-width: 1180px)');
  const [filter, setFilter] = useState<Filter>('all');

  const searched = useMemo(
    () => searchRows(rows, { query, hideRejected, accounts: snapshot.accounts }),
    [rows, query, hideRejected, snapshot.accounts],
  );
  const counts = useMemo(() => countByFilter(searched), [searched]);
  const groups = useMemo(() => groupRows(filterRows(searched, filter), today), [searched, filter, today]);
  const stats = useMemo(() => computeStats(snapshot.applications, today), [snapshot.applications, today]);
  const selected = selectedId ? (rows.find((row) => row.job.id === selectedId) ?? null) : null;

  return (
    <div style={{ '--reserve': `${selected && wide ? PANEL_RESERVE : 0}px` } as CSSProperties}>
      <main className="pr-(--reserve) transition-[padding] duration-300 ease-out">
        <div className="mx-auto w-full max-w-[1040px] px-4 pt-[100px] pb-32 sm:px-6 md:pb-24">
          <SetupChecklist snapshot={snapshot} />
          <StatsRow stats={stats} today={today} goal={goal} />

          <div className="mt-10 mb-3 -mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
            <FilterControl
              filter={filter}
              onFilter={setFilter}
              counts={counts}
              layoutId="filter"
              size={wide ? 'md' : 'sm'}
            />
          </div>

          {groups.length > 0 ? (
            <JobList
              groups={groups}
              accounts={snapshot.accounts}
              today={today}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ) : rows.length > 0 ? (
            <p className="py-16 text-center text-[14px] text-fg-2">{t('list.noMatch')}</p>
          ) : snapshot.accounts.length === 0 ? (
            <EmptyState
              icon={<AtSign className="size-6 text-fg-2" aria-hidden="true" />}
              title={t('onboarding.title')}
              body={t('onboarding.body')}
              action={
                <Button variant="primary" className="mt-5" onClick={() => navigate(PAGE_PATHS.welcome)}>
                  {t('onboarding.action')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Send className="size-6 text-fg-2" aria-hidden="true" />}
              title={t('list.emptyTitle')}
              body={t('list.emptyBody')}
            />
          )}
        </div>
      </main>
      <DetailPanel row={selected} snapshot={snapshot} today={today} onClose={() => onSelect(null)} />
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="py-20 text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-fill">{icon}</div>
      <h2 className="mt-4 text-[17px] font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-[420px] text-[14px] text-fg-2">{body}</p>
      {action}
    </div>
  );
}
