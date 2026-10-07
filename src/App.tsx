import { MotionConfig } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { UnauthorizedError } from './data/httpRepository';
import { localRepository, useCurrentUser, useSnapshot } from './data/store';
import { buildRows } from './domain/rows';
import type { Id, Snapshot } from './domain/types';
import { useHotkey } from './hooks/useHotkey';
import { useThemeSync } from './hooks/useThemeSync';
import { useI18n } from './i18n/context';
import { getPrefs } from './state/prefs';
import { navigate, PAGE_PATHS, useLocation } from './state/router';
import { ApplicationsPage } from './ui/ApplicationsPage';
import { Composer } from './ui/Composer';
import { Guide } from './ui/Guide';
import { InsightsPage } from './ui/InsightsPage';
import { Button } from './ui/primitives';
import { ProfilePage } from './ui/ProfilePage';
import { ResumesPage } from './ui/ResumesPage';
import { SettingsDialog } from './ui/SettingsDialog';
import { SignIn } from './ui/SignIn';
import { Toaster } from './ui/Toaster';
import { TabBar, Toolbar } from './ui/Toolbar';
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

/** Local mode opens straight into the workspace; otherwise the owner has to be signed in first. */
function Gate() {
  const user = useCurrentUser();
  // Asked for along with the user, not after: a signed-out owner gets the same answer from both.
  const snapshot = useSnapshot(localRepository !== null || !user.isError);

  if (user.error instanceof UnauthorizedError || snapshot.error instanceof UnauthorizedError)
    return <SignIn />;
  if (user.isError) return <LoadError onRetry={() => void user.refetch()} />;
  if (snapshot.isError) return <LoadError onRetry={() => void snapshot.refetch()} />;
  return snapshot.data ? <Workspace snapshot={snapshot.data} /> : null;
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
  const { page, params } = useLocation();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const rows = useMemo(() => buildRows(snapshot), [snapshot]);

  // A new owner, with nothing set up yet, starts in the guide; once finished or put off, it waits in the menu.
  useEffect(() => {
    const fresh = snapshot.accounts.length === 0 && snapshot.jobs.length === 0;
    if (fresh && !getPrefs().setup.guideSeen && page === 'applications')
      navigate(PAGE_PATHS.welcome, { replace: true });
    // Only as Outbox opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // N opens the quick-add panel anywhere but the guide and over the settings dialog.
  useHotkey('n', () => !settingsOpen && page !== 'welcome' && setComposing(true));

  const composer = (
    <Composer
      open={composing}
      onOpenChange={setComposing}
      snapshot={snapshot}
      rows={rows}
      onOpenJob={(id) => {
        setComposing(false);
        setSelectedId(id);
        navigate(PAGE_PATHS.applications);
      }}
      onOpenSettings={() => {
        setComposing(false);
        setSettingsOpen(true);
      }}
    />
  );

  if (page === 'welcome')
    return (
      <>
        <Guide snapshot={snapshot} step={Number(params.get('step') ?? 1)} />
        <Toaster />
      </>
    );

  return (
    <>
      <Toolbar
        page={page}
        query={query}
        onQuery={setQuery}
        onCompose={() => setComposing(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        snapshot={snapshot}
      />
      {page === 'applications' && (
        <ApplicationsPage
          snapshot={snapshot}
          rows={rows}
          query={query}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}
      {page === 'resumes' && <ResumesPage snapshot={snapshot} />}
      {page === 'profile' && <ProfilePage resumes={snapshot.resumes} readFirst={params.get('read')} />}
      {page === 'insights' && <InsightsPage snapshot={snapshot} />}
      <TabBar page={page} onCompose={() => setComposing(true)} />
      {composer}
      <Toaster />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} snapshot={snapshot} />
      <TweakPanel />
    </>
  );
}
