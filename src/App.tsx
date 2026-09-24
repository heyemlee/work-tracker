import { AtSign, Send } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { UnauthorizedError } from './data/httpRepository';
import { localRepository, useCurrentUser, useSnapshot } from './data/store';
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
import { DemoBanner } from './ui/DemoBanner';
import { DetailPanel } from './ui/DetailPanel';
import { JobList } from './ui/JobList';
import { Button, Switch } from './ui/primitives';
import { SettingsDialog } from './ui/SettingsDialog';
import { DemoStart, SignIn } from './ui/SignIn';
import { StatsRow } from './ui/StatsRow';
import { FilterControl, Toolbar } from './ui/Toolbar';
import { TweakPanel } from './ui/TweakPanel';

/** Width the open inspector takes from the page on wide screens: panel + its margin. */
const PANEL_RESERVE = 444;

export function App() {
  useThemeSync();
  return (
    <MotionConfig reducedMotion="user">
      <div aria-hidden="true" className="ambient" />
      <Gate />
    </MotionConfig>
  );
}

/**
 * Local mode opens straight into the workspace. Otherwise the owner has to be signed in first, and a demo
 * visitor gets a sandbox of their own.
 */
function Gate() {
  const user = useCurrentUser();
  const snapshot = useSnapshot(localRepository !== null || user.isSuccess);

  const signedOut = [user.error, snapshot.error].find((error) => error instanceof UnauthorizedError);
  if (signedOut) return signedOut.demo ? <DemoStart /> : <SignIn demoUrl={signedOut.demoUrl} />;
  if (user.isError) return <LoadError onRetry={() => void user.refetch()} />;
  if (snapshot.isError) return <LoadError onRetry={() => void snapshot.refetch()} />;
  return snapshot.data ? <Workspace snapshot={snapshot.data} /> : null;
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

function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <main className="grid min-h-dvh place-items-center p-4 text-center">
      <div>
        <p className="text-[15px] text-fg-2">{t('error.load')}</p>
        <Button className="mt-4" onClick={onRetry}>
          {t('error.retry')}
        </Button>
      </div>
    </main>
  );
}

function Workspace({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useI18n();
  const demo = useCurrentUser().data?.demo ?? false;
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
          {demo && <DemoBanner />}
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
          ) : snapshot.accounts.length === 0 ? (
            <EmptyState
              icon={<AtSign className="size-6 text-fg-2" aria-hidden="true" />}
              title={t('onboarding.title')}
              body={t('onboarding.body')}
              action={
                <Button variant="primary" className="mt-5" onClick={() => setSettingsOpen(true)}>
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

      <Composer
        snapshot={snapshot}
        rows={rows}
        onOpenJob={setSelectedId}
        onOpenSettings={() => setSettingsOpen(true)}
        // Below the wide breakpoint the inspector covers the composer's corner; slide it away meanwhile.
        hidden={selected !== null && !wide}
      />
      <DetailPanel row={selected} snapshot={snapshot} today={today} onClose={() => setSelectedId(null)} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} snapshot={snapshot} />
      <TweakPanel />
    </div>
  );
}
