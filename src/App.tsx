import { Send } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { useMemo, useState, type CSSProperties } from 'react';
import { useSnapshot } from './data/store';
import {
  buildRows,
  computeStats,
  countByFilter,
  filterRows,
  groupRows,
  searchRows,
  type Filter,
} from './domain/rows';
import type { Id, Snapshot } from './domain/types';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useThemeSync } from './hooks/useThemeSync';
import { useToday } from './hooks/useToday';
import { useI18n } from './i18n/context';
import { updatePrefs, usePrefs } from './state/prefs';
import { Composer } from './ui/Composer';
import { DetailPanel } from './ui/DetailPanel';
import { JobList } from './ui/JobList';
import { Switch } from './ui/primitives';
import { SettingsDialog } from './ui/SettingsDialog';
import { StatsRow } from './ui/StatsRow';
import { FilterControl, Toolbar } from './ui/Toolbar';
import { TweakPanel } from './ui/TweakPanel';

/** Width the open inspector takes from the page on wide screens: panel + its margin. */
const PANEL_RESERVE = 444;

export function App() {
  useThemeSync();
  const { data: snapshot } = useSnapshot();
  return (
    <MotionConfig reducedMotion="user">
      <div aria-hidden="true" className="ambient" />
      {snapshot && <Workspace snapshot={snapshot} />}
    </MotionConfig>
  );
}

function Workspace({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useI18n();
  const today = useToday();
  const hideRejected = usePrefs((p) => p.hideRejected);
  const wide = useMediaQuery('(min-width: 1180px)');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const rows = useMemo(() => buildRows(snapshot), [snapshot]);
  const searched = useMemo(
    () => searchRows(rows, { query, hideRejected, accounts: snapshot.accounts }),
    [rows, query, hideRejected, snapshot.accounts],
  );
  const counts = useMemo(() => countByFilter(searched), [searched]);
  const groups = useMemo(() => groupRows(filterRows(searched, filter), today), [searched, filter, today]);
  const stats = useMemo(() => computeStats(snapshot.applications, today), [snapshot.applications, today]);
  const selected = selectedId ? (rows.find((row) => row.job.id === selectedId) ?? null) : null;
  const shown = counts[filter];

  return (
    <div style={{ '--reserve': `${selected && wide ? PANEL_RESERVE : 0}px` } as CSSProperties}>
      <Toolbar
        filter={filter}
        onFilter={setFilter}
        query={query}
        onQuery={setQuery}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="pr-(--reserve) transition-[padding] duration-300 ease-out">
        <div className="mx-auto w-full max-w-[1040px] px-4 pt-[100px] pb-52 sm:px-6">
          <StatsRow stats={stats} today={today} />

          <div className="mt-10 mb-3 flex flex-wrap items-center gap-3">
            <div className="md:hidden">
              <FilterControl filter={filter} onFilter={setFilter} layoutId="filter-inline" size="sm" />
            </div>
            <p className="hidden px-1 text-[13px] text-fg-2 md:block">
              {shown === 1 ? t('list.jobsOne') : t('list.jobsMany', { count: shown })}
            </p>
            <label className="ml-auto flex items-center gap-2 text-[13px] text-fg-2">
              {t('list.hideRejected')}
              <Switch
                checked={hideRejected}
                onCheckedChange={(value) => updatePrefs({ hideRejected: value })}
              />
            </label>
          </div>

          {groups.length > 0 ? (
            <JobList
              groups={groups}
              accounts={snapshot.accounts}
              today={today}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : rows.length > 0 ? (
            <p className="py-16 text-center text-[14px] text-fg-2">{t('list.noMatch')}</p>
          ) : (
            <div className="py-20 text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-fill">
                <Send className="size-6 text-fg-2" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-[17px] font-semibold">{t('list.emptyTitle')}</h2>
              <p className="mt-1 text-[14px] text-fg-2">{t('list.emptyBody')}</p>
            </div>
          )}
        </div>
      </main>

      <Composer snapshot={snapshot} rows={rows} onOpenJob={setSelectedId} />
      <DetailPanel row={selected} snapshot={snapshot} today={today} onClose={() => setSelectedId(null)} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} snapshot={snapshot} />
      <TweakPanel />
    </div>
  );
}
