import { AtSign, Send, X } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { useMemo, useState, type ReactNode } from 'react';
import { UnauthorizedError } from './data/httpRepository';
import { localRepository, useCurrentUser, useSnapshot } from './data/store';
import {
  buildRows,
  computeStats,
  countByAccount,
  countByFilter,
  filterRows,
  groupRows,
  searchRows,
  type Filter,
} from './domain/rows';
import type { Account, Id, Snapshot } from './domain/types';
import { useHotkey } from './hooks/useHotkey';
import { useLayout } from './hooks/useLayout';
import { useThemeSync } from './hooks/useThemeSync';
import { useToday } from './hooks/useToday';
import { useI18n } from './i18n/context';
import { updatePrefs, usePrefs } from './state/prefs';
import { Composer, ComposerSheet } from './ui/Composer';
import { DemoBanner } from './ui/DemoBanner';
import { DetailPane, DetailPanel } from './ui/DetailPanel';
import { JobList } from './ui/JobList';
import { Button, Switch } from './ui/primitives';
import { SettingsDialog } from './ui/SettingsDialog';
import { Sidebar } from './ui/Sidebar';
import { DemoStart, SignIn } from './ui/SignIn';
import { StatsRow } from './ui/StatsRow';
import { Toaster } from './ui/Toaster';
import { GlassPane } from './ui/glass/GlassPane';
import { FilterControl, MobileBar, SearchField } from './ui/Toolbar';
import { TweakPanel } from './ui/TweakPanel';

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
    <div className="px-6 py-20 text-center">
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
  const layout = useLayout();
  const hideRejected = usePrefs((p) => p.hideRejected);
  const [filter, setFilter] = useState<Filter>('all');
  const [pickedAccountId, setPickedAccountId] = useState<Id | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composing, setComposing] = useState(false);

  // Phones have no sidebar to narrow by account, and a deleted account narrows nothing.
  const account =
    layout === 'phone' ? null : (snapshot.accounts.find((a) => a.id === pickedAccountId) ?? null);
  const accountId = account?.id ?? null;

  const rows = useMemo(() => buildRows(snapshot), [snapshot]);
  // The sidebar counts leave the search out, so they hold still while typing.
  const kept = useMemo(
    () => (hideRejected ? rows.filter((row) => !row.rejected) : rows),
    [rows, hideRejected],
  );
  const counts = useMemo(() => countByFilter(kept, accountId), [kept, accountId]);
  const accountCounts = useMemo(() => countByAccount(kept), [kept]);
  const searched = useMemo(
    () => searchRows(rows, { query, hideRejected, accounts: snapshot.accounts }),
    [rows, query, hideRejected, snapshot.accounts],
  );
  const shown = useMemo(() => filterRows(searched, filter, accountId), [searched, filter, accountId]);
  const groups = useMemo(() => groupRows(shown, today), [shown, today]);
  const stats = useMemo(() => computeStats(snapshot.applications, today), [snapshot.applications, today]);
  const selected = selectedId ? (rows.find((row) => row.job.id === selectedId) ?? null) : null;

  useHotkey('n', () => layout === 'phone' && setComposing(true));

  const openSettings = () => setSettingsOpen(true);
  const closeJob = () => setSelectedId(null);

  const list =
    groups.length > 0 ? (
      <JobList
        groups={groups}
        accounts={snapshot.accounts}
        today={today}
        selectedId={selectedId}
        onSelect={setSelectedId}
        stickyHeadings={layout !== 'phone'}
      />
    ) : rows.length > 0 ? (
      <p className="px-6 py-16 text-center text-[14px] text-fg-2">{t('list.noMatch')}</p>
    ) : snapshot.accounts.length === 0 ? (
      <EmptyState
        icon={<AtSign className="size-6 text-fg-2" aria-hidden="true" />}
        title={t('onboarding.title')}
        body={t('onboarding.body')}
        action={
          <Button variant="primary" className="mt-5" onClick={openSettings}>
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
    );

  const overlays = (
    <>
      {layout !== 'wide' && (
        <DetailPanel row={selected} snapshot={snapshot} today={today} onClose={closeJob} />
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} snapshot={snapshot} />
      <Toaster />
      <TweakPanel />
    </>
  );

  if (layout === 'phone') {
    return (
      <>
        <MobileBar
          query={query}
          onQuery={setQuery}
          onCompose={() => setComposing(true)}
          onOpenSettings={openSettings}
        />
        <main className="px-4 pt-[calc(max(12px,env(safe-area-inset-top))+76px)] pb-24">
          {demo && <DemoBanner />}
          <StatsRow stats={stats} today={today} />
          <div className="mt-8 mb-3 flex flex-wrap items-center gap-3">
            <FilterControl filter={filter} onFilter={setFilter} layoutId="filter-phone" size="sm" />
            <label className="ml-auto flex items-center gap-2 text-[13px] text-fg-2">
              {t('list.hideRejected')}
              <Switch
                checked={hideRejected}
                onCheckedChange={(value) => updatePrefs({ hideRejected: value })}
              />
            </label>
          </div>
          {groups.length > 0 ? (
            <div className="glass glass-pane @container overflow-hidden rounded-[22px]">{list}</div>
          ) : (
            list
          )}
        </main>
        <ComposerSheet
          open={composing}
          onOpenChange={setComposing}
          snapshot={snapshot}
          rows={rows}
          onOpenJob={setSelectedId}
          onOpenSettings={openSettings}
        />
        {overlays}
      </>
    );
  }

  const summary = [
    shown.length === 1 ? t('list.jobsOne') : t('list.jobsMany', { count: shown.length }),
    t('stats.todayLine', { count: stats.today }),
    t('stats.weekLine', { count: stats.week }),
  ].join(' · ');

  return (
    <>
      <div className="flex h-dvh gap-3 p-3">
        <Sidebar
          filter={filter}
          onFilter={setFilter}
          counts={counts}
          accounts={snapshot.accounts}
          accountCounts={accountCounts}
          accountId={accountId}
          onAccount={setPickedAccountId}
          onOpenSettings={openSettings}
          footer={demo ? <DemoBanner variant="card" /> : undefined}
        />
        <main className="flex min-w-0 flex-1">
          <GlassPane
            radius={24}
            bevel={18}
            className="glass-pane flex min-w-0 flex-1 flex-col overflow-hidden rounded-[24px]"
          >
            <ListHeader
              title={filter === 'all' ? t('list.titleAll') : t(`status.${filter}`)}
              account={account}
              onClearAccount={() => setPickedAccountId(null)}
              summary={summary}
              query={query}
              onQuery={setQuery}
            />
            <div className="px-4 pb-4">
              <Composer
                snapshot={snapshot}
                rows={rows}
                onOpenJob={setSelectedId}
                onOpenSettings={openSettings}
              />
            </div>
            <div className="scroll-area @container min-h-0 flex-1 border-t border-hairline">{list}</div>
          </GlassPane>
        </main>
        {layout === 'wide' && (
          <DetailPane row={selected} snapshot={snapshot} today={today} stats={stats} onClose={closeJob} />
        )}
      </div>
      {overlays}
    </>
  );
}

interface ListHeaderProps {
  title: string;
  account: Account | null;
  onClearAccount: () => void;
  summary: string;
  query: string;
  onQuery: (query: string) => void;
}

function ListHeader({ title, account, onClearAccount, summary, query, onQuery }: ListHeaderProps) {
  const { t } = useI18n();
  return (
    <header className="flex items-start gap-4 px-5 pt-5 pb-4">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[22px] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
          {account && (
            <button
              type="button"
              onClick={onClearAccount}
              aria-label={t('list.clearAccount')}
              title={t('list.clearAccount')}
              className="flex h-7 min-w-0 items-center gap-1.5 rounded-full bg-fill pr-2 pl-2.5 text-[13px] font-medium transition-colors hover:bg-fill-2"
            >
              <span className="dot" style={{ background: `var(--acc-${account.color})` }} />
              <span className="max-w-[220px] truncate">{account.email || account.label}</span>
              <X className="size-3.5 shrink-0 text-fg-3" aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="mt-1 truncate text-[13px] text-fg-2">{summary}</p>
      </div>
      <SearchField query={query} onQuery={onQuery} className="w-[240px] shrink-0" />
    </header>
  );
}
