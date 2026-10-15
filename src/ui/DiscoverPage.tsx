import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  Building2,
  Check,
  ChevronRight,
  Compass,
  ExternalLink,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { localToolRequest, type Board, type DiscoveredJob, type SyncStatus } from '../data/localTools';
import { useRepository } from '../data/store';
import { saveDiscoveredPosting, trackedPosting } from '../domain/discovery';
import { cleanLink } from '../domain/postings';
import type { Snapshot } from '../domain/types';
import { useI18n } from '../i18n/context';
import { navigate, PAGE_PATHS, useLocation } from '../state/router';
import { showToast } from '../state/toasts';
import { ToolDialog, ToolNotice, toolInput, toolPage } from './LocalTools';
import { Button, IconButton } from './primitives';

export function DiscoverPage({
  snapshot,
  onOpenJob,
}: {
  snapshot: Snapshot;
  onOpenJob: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const { params } = useLocation();
  const queryClient = useQueryClient();
  const run = useRepository();
  const [companiesOpen, setCompaniesOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const boards = useQuery({
    queryKey: ['local-tools', 'boards'],
    queryFn: () => localToolRequest<Board[]>('/api/boards'),
    retry: false,
  });
  const status = useQuery({
    queryKey: ['local-tools', 'sync'],
    queryFn: () => localToolRequest<SyncStatus>('/api/sync'),
    retry: false,
    enabled: boards.isSuccess,
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  });
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !status.data?.running) {
      void queryClient.invalidateQueries({ queryKey: ['local-tools', 'boards'] });
      void queryClient.invalidateQueries({ queryKey: ['local-tools', 'jobs'] });
    }
    wasRunning.current = !!status.data?.running;
  }, [status.data?.running, queryClient]);
  const filters = new URLSearchParams();
  for (const key of ['q', 'location', 'boardId', 'remote', 'active', 'page']) {
    const value = params.get(key);
    if (value) filters.set(key, value);
  }
  const jobs = useQuery({
    queryKey: ['local-tools', 'jobs', filters.toString()],
    queryFn: () =>
      localToolRequest<{ items: DiscoveredJob[]; hasMore: boolean; page: number }>(`/api/jobs?${filters}`),
    enabled: boards.isSuccess,
    retry: false,
  });
  const selected = params.get('job');
  const detail = useQuery({
    queryKey: ['local-tools', 'job', selected],
    queryFn: () => localToolRequest<DiscoveredJob>(`/api/jobs/${encodeURIComponent(selected!)}`),
    enabled: !!selected && boards.isSuccess,
    retry: false,
  });
  const change = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    navigate(`${PAGE_PATHS.discovery}?${next}`);
  };
  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await queryClient.invalidateQueries({ queryKey: ['local-tools'] });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const save = async (job: DiscoveredJob) => {
    if (saving) return;
    setSaving(true);
    const result = await run((repo) => saveDiscoveredPosting(repo, job));
    setSaving(false);
    if (result) showToast({ message: t('discover.saved') });
  };
  const stamp = (value: string) => new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US');

  const followed = boards.data?.filter((board) => board.enabled) ?? [];
  const filterCount = ['location', 'boardId', 'remote', 'active'].filter(
    (key) => params.has(key) && !(key === 'active' && params.get(key) === 'true'),
  ).length;
  const hasSearch = !!params.get('q') || filterCount > 0;
  const sync = () =>
    mutate(async () => {
      const progress = await localToolRequest<SyncStatus>('/api/sync', 'POST');
      queryClient.setQueryData(['local-tools', 'sync'], progress);
    });
  const syncButton = (
    <Button
      disabled={busy || status.data?.running || !followed.length}
      onClick={() => void sync()}
      title={
        status.data?.finishedAt
          ? t('discover.synced', { date: stamp(status.data.finishedAt) })
          : t('discover.never')
      }
    >
      <RefreshCw className={clsx('size-3.5', status.data?.running && 'animate-spin')} />
      {status.data?.running
        ? t('discover.syncing', { done: status.data.completed, total: status.data.total })
        : t('discover.sync')}
    </Button>
  );
  const issues =
    status.data?.error ||
    status.data?.results
      .filter((r) => r.error)
      .map((r) => `${r.company}: ${r.error}`)
      .join(' · ');

  return (
    <main className={toolPage}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{t('nav.discovery')}</h1>
          <p className="mt-1 text-[14px] text-fg-2">{t('discover.intro')}</p>
        </div>
        {boards.isSuccess && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setCompaniesOpen(true)}>
              <Building2 className="size-4" />
              {t('discover.manage')}
              <span className="text-fg-3">{followed.length}</span>
            </Button>
            {followed.length > 0 && syncButton}
          </div>
        )}
      </header>
      {boards.isPending ? (
        <ToolNotice loading />
      ) : boards.isError ? (
        <ToolNotice error={boards.error} retry={() => void boards.refetch()} />
      ) : (
        <>
          {!companiesOpen && error != null && <ToolNotice error={error} />}
          {status.isError && <ToolNotice error={status.error} retry={() => void status.refetch()} />}
          {issues && (
            <details className="mt-4 rounded-xl bg-fill px-4 py-3 text-[13px] text-fg-2">
              <summary className="cursor-pointer">{t('discover.syncIssues')}</summary>
              <p className="mt-2 break-words">{issues}</p>
            </details>
          )}
          {!followed.length ? (
            <section className="card mt-8 flex flex-col items-center px-6 py-14 text-center sm:py-20">
              <div className="mb-6 grid size-16 place-items-center rounded-[22px] bg-fill text-fg-2">
                <Compass className="size-7" strokeWidth={1.5} />
              </div>
              <h2 className="text-[23px] font-semibold tracking-tight">{t('discover.startTitle')}</h2>
              <p className="mt-3 max-w-sm text-[14px] leading-6 text-fg-2">{t('discover.startBody')}</p>
              <Button variant="primary" className="mt-6 h-10 px-5" onClick={() => setCompaniesOpen(true)}>
                {t('discover.choose')}
                <ChevronRight className="size-4" />
              </Button>
              <p className="mt-5 text-[12px] text-fg-3">{t('discover.catalog', { n: boards.data.length })}</p>
            </section>
          ) : (
            <>
              <form
                key={filters.toString()}
                className="mt-7"
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = new URLSearchParams();
                  for (const [key, value] of new FormData(e.currentTarget))
                    if (String(value).trim() && !(key === 'active' && value === 'true'))
                      next.set(key, String(value).trim());
                  navigate(`${PAGE_PATHS.discovery}?${next}`);
                }}
              >
                <div className="card flex items-center gap-3 rounded-[18px] p-2 pl-4 focus-within:ring-2 focus-within:ring-accent/25">
                  <Search className="size-5 shrink-0 text-fg-3" />
                  <input
                    type="search"
                    name="q"
                    aria-label={t('discover.query')}
                    placeholder={t('discover.searchPlaceholder')}
                    maxLength={200}
                    defaultValue={params.get('q') ?? ''}
                    className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    className="h-10 px-4"
                    aria-label={t('discover.search')}
                  >
                    <Search className="size-4 sm:hidden" />
                    <span className="max-sm:hidden">{t('discover.search')}</span>
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant={filtersOpen || filterCount ? 'secondary' : 'ghost'}
                      aria-expanded={filtersOpen}
                      aria-controls="job-filters"
                      onClick={() => setFiltersOpen(!filtersOpen)}
                    >
                      <SlidersHorizontal className="size-3.5" />
                      {t('discover.filters')}
                      {filterCount > 0 && <span className="text-fg-3">{filterCount}</span>}
                    </Button>
                    {hasSearch && (
                      <Button variant="ghost" onClick={() => navigate(PAGE_PATHS.discovery)}>
                        <X className="size-3" />
                        {t('discover.clear')}
                      </Button>
                    )}
                  </div>
                  <p className="text-[12px] text-fg-3">{t('discover.following', { n: followed.length })}</p>
                </div>
                <div id="job-filters" hidden={!filtersOpen} className="card mt-3 p-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-[12px] text-fg-2">
                      {t('discover.location')}
                      <input
                        name="location"
                        maxLength={200}
                        defaultValue={params.get('location') ?? ''}
                        className={`${toolInput} mt-1`}
                      />
                    </label>
                    <label className="text-[12px] text-fg-2">
                      {t('discover.companies')}
                      <select
                        name="boardId"
                        defaultValue={params.get('boardId') ?? ''}
                        className={`${toolInput} mt-1`}
                      >
                        <option value="">{t('discover.allCompanies')}</option>
                        {followed.map((board) => (
                          <option key={board.id} value={board.id}>
                            {board.company}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[12px] text-fg-2">
                      {t('discover.workplace')}
                      <select
                        name="remote"
                        defaultValue={params.get('remote') ?? ''}
                        className={`${toolInput} mt-1`}
                      >
                        <option value="">{t('discover.anywhere')}</option>
                        <option value="true">{t('discover.remote')}</option>
                        <option value="false">{t('discover.onsite')}</option>
                      </select>
                    </label>
                    <label className="text-[12px] text-fg-2">
                      {t('discover.status')}
                      <select
                        name="active"
                        defaultValue={params.get('active') ?? 'true'}
                        className={`${toolInput} mt-1`}
                      >
                        <option value="true">{t('discover.active')}</option>
                        <option value="false">{t('discover.closed')}</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button type="submit">{t('discover.applyFilters')}</Button>
                  </div>
                </div>
              </form>
              {jobs.isPending ? (
                <ToolNotice loading />
              ) : jobs.isError ? (
                <ToolNotice error={jobs.error} retry={() => void jobs.refetch()} />
              ) : (
                <>
                  {!jobs.data.items.length ? (
                    <section className="card mt-5 px-6 py-12 text-center">
                      <Search className="mx-auto mb-4 size-6 text-fg-3" />
                      <h2 className="text-[18px] font-semibold">
                        {t(hasSearch ? 'discover.noMatchTitle' : 'discover.emptyTitle')}
                      </h2>
                      <p className="mx-auto mt-2 max-w-sm text-[14px] leading-6 text-fg-2">
                        {t(hasSearch ? 'discover.noMatchBody' : 'discover.emptySync')}
                      </p>
                      <div className="mt-5">
                        {hasSearch ? (
                          <Button onClick={() => navigate(PAGE_PATHS.discovery)}>
                            {t('discover.clear')}
                          </Button>
                        ) : (
                          syncButton
                        )}
                      </div>
                    </section>
                  ) : (
                    <>
                      <p className="mt-6 mb-2 px-1 text-[12px] text-fg-3">
                        {t('discover.results', { n: jobs.data.items.length })}
                      </p>
                      <div className="card divide-y divide-hairline overflow-hidden rounded-[22px]">
                        {jobs.data.items.map((job) => {
                          const saved = trackedPosting(snapshot, job);
                          return (
                            <article
                              key={job.id}
                              className="flex items-center gap-3 p-4 transition-colors hover:bg-fill sm:gap-4 sm:p-5"
                            >
                              <div
                                aria-hidden="true"
                                className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-fill text-[16px] font-semibold text-fg-2 max-[360px]:hidden"
                              >
                                {job.company.slice(0, 1).toUpperCase()}
                              </div>
                              <button
                                className="min-w-0 flex-1 text-left outline-offset-4"
                                onClick={() => change('job', job.id)}
                                aria-label={job.title}
                              >
                                <h2 className="text-[16px] leading-6 font-semibold tracking-[-0.01em] break-words">
                                  {job.title}
                                </h2>
                                <p className="mt-0.5 text-[13px] break-words text-fg-2">{job.company}</p>
                                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-3">
                                  <span className="inline-flex items-center gap-1">
                                    <MapPin className="size-3" />
                                    {job.location || t('discover.anywhere')}
                                  </span>
                                  {job.remote && <span>{t('discover.remote')}</span>}
                                  {!job.active && <span>{t('discover.closed')}</span>}
                                </p>
                              </button>
                              <IconButton
                                label={`${t(saved ? 'discover.view' : 'discover.save')}: ${job.title}`}
                                disabled={saving || !cleanLink(job.url)}
                                className={saved ? 'text-accent' : 'text-fg-3'}
                                onClick={() => (saved ? onOpenJob(saved.job.id) : void save(job))}
                              >
                                {saved ? (
                                  <BookmarkCheck className="size-[18px]" />
                                ) : (
                                  <Bookmark className="size-[18px]" />
                                )}
                              </IconButton>
                            </article>
                          );
                        })}
                      </div>
                      <p className="mt-3 px-1 text-[12px] text-fg-3">{t('discover.saveHint')}</p>
                    </>
                  )}
                  {(jobs.data.hasMore || jobs.data.page > 1) && (
                    <div className="mt-5 flex items-center justify-center gap-3">
                      <Button
                        disabled={jobs.data.page <= 1}
                        onClick={() => change('page', String(jobs.data.page - 1))}
                      >
                        {t('pager.prev')}
                      </Button>
                      <span className="text-[12px] text-fg-3">
                        {t('discover.page', { n: jobs.data.page })}
                      </span>
                      <Button
                        disabled={!jobs.data.hasMore}
                        onClick={() => change('page', String(jobs.data.page + 1))}
                      >
                        {t('pager.next')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <CompanyManager
            open={companiesOpen}
            onOpenChange={setCompaniesOpen}
            boards={boards.data}
            busy={busy}
            error={error}
            mutate={mutate}
            onSync={() => {
              setCompaniesOpen(false);
              void sync();
            }}
            syncing={!!status.data?.running}
          />
          <ToolDialog
            open={!!selected}
            onOpenChange={(open) => {
              if (!open) change('job', null);
            }}
            title={t('discover.details')}
            side
          >
            <section aria-label={t('discover.details')}>
              {detail.isPending ? (
                <ToolNotice loading />
              ) : detail.isError ? (
                <ToolNotice error={detail.error} retry={() => void detail.refetch()} />
              ) : (
                <>
                  <p className="text-[13px] font-medium text-fg-2">{detail.data.company}</p>
                  <h2 className="mt-2 text-[26px] leading-tight font-semibold tracking-tight break-words">
                    {detail.data.title}
                  </h2>
                  <p className="mt-3 text-[14px] text-fg-2">
                    {[
                      detail.data.location,
                      detail.data.department,
                      !detail.data.active ? t('discover.closed') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <div className="my-6 flex flex-wrap items-center gap-2">
                    <PostingActions
                      job={detail.data}
                      snapshot={snapshot}
                      saving={saving}
                      save={save}
                      onOpenJob={onOpenJob}
                    />
                  </div>
                  <div className="border-t border-hairline pt-6">
                    <h3 className="text-[14px] font-semibold">{t('discover.aboutRole')}</h3>
                    <p className="mt-3 text-[14px] leading-7 whitespace-pre-wrap break-words">
                      {detail.data.description || t('discover.noDescription')}
                    </p>
                  </div>
                </>
              )}
            </section>
          </ToolDialog>
        </>
      )}
    </main>
  );
}

function CompanyManager({
  open,
  onOpenChange,
  boards,
  busy,
  error,
  mutate,
  onSync,
  syncing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boards: Board[];
  busy: boolean;
  error: unknown;
  mutate: (operation: () => Promise<unknown>) => Promise<void>;
  onSync: () => void;
  syncing: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [onlyFollowed, setOnlyFollowed] = useState(false);
  const following = boards.filter((b) => b.enabled).length;
  const visible = boards.filter(
    (board) =>
      (!onlyFollowed || board.enabled) && board.company.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <ToolDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('discover.manage')}
      description={t('discover.sources')}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] text-fg-2">{t('discover.following', { n: following })}</span>
          <Button variant="primary" disabled={busy || !following || syncing} onClick={onSync}>
            {t('discover.readySync')}
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-fill px-3">
          <Search className="size-4 shrink-0 text-fg-3" />
          <input
            aria-label={t('discover.companySearch')}
            placeholder={t('discover.companySearch')}
            className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Button
          className="self-start sm:self-auto"
          aria-pressed={onlyFollowed}
          onClick={() => setOnlyFollowed(!onlyFollowed)}
          variant={onlyFollowed ? 'secondary' : 'ghost'}
        >
          {onlyFollowed && <Check className="size-3" />}
          {t('discover.followedOnly')}
        </Button>
      </div>
      <div className="mt-4 max-h-[min(340px,40dvh)] overflow-y-auto overscroll-contain rounded-xl border border-hairline">
        {!visible.length && (
          <p className="p-5 text-[13px] leading-6 text-fg-2">{t('discover.companyNoMatch')}</p>
        )}
        {visible.map((board) => (
          <label
            key={board.id}
            className="flex cursor-pointer items-start gap-3 border-b border-hairline px-3 py-3 last:border-0 hover:bg-fill"
          >
            <input
              aria-label={board.company}
              type="checkbox"
              checked={board.enabled}
              disabled={busy}
              className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
              onChange={(e) => {
                const enabled = e.target.checked;
                void mutate(() => localToolRequest(`/api/boards/${board.id}`, 'PATCH', { enabled }));
              }}
            />
            <span className="min-w-0 flex-1 text-[14px]">
              <span className="font-medium break-words">{board.company}</span>
              <span className="mt-0.5 block text-[12px] text-fg-3">
                {board.provider} · {t('discover.jobsCount', { n: board.activeJobs })}
              </span>
              {board.lastError && (
                <span className="mt-1 block break-words text-[12px] text-danger">{board.lastError}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      <details className="group mt-5">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-fg-2 [&::-webkit-details-marker]:hidden">
          <Plus className="size-4" />
          {t('discover.add')}
        </summary>
        <form
          className="mt-3 space-y-3 rounded-xl bg-fill p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fields = new FormData(form);
            void mutate(async () => {
              await localToolRequest('/api/boards', 'POST', {
                company: fields.get('company'),
                url: fields.get('url'),
              });
              form.reset();
              setQuery('');
              setOnlyFollowed(false);
            });
          }}
        >
          <label className="block text-[12px] text-fg-2">
            {t('discover.company')}
            <input required maxLength={200} name="company" className={`${toolInput} mt-1`} />
          </label>
          <label className="block text-[12px] text-fg-2">
            {t('discover.url')}
            <input
              required
              type="url"
              name="url"
              placeholder="https://jobs.lever.co/company"
              className={`${toolInput} mt-1`}
            />
          </label>
          <Button disabled={busy} type="submit">
            {t('discover.add')}
          </Button>
        </form>
      </details>
      {error != null && <ToolNotice error={error} />}
    </ToolDialog>
  );
}

function PostingActions({
  job,
  snapshot,
  saving,
  save,
  onOpenJob,
}: {
  job: DiscoveredJob;
  snapshot: Snapshot;
  saving: boolean;
  save: (job: DiscoveredJob) => Promise<void>;
  onOpenJob: (id: string) => void;
}) {
  const { t } = useI18n();
  const existing = trackedPosting(snapshot, job);
  const url = cleanLink(job.url);
  return (
    <>
      {existing ? (
        <Button onClick={() => onOpenJob(existing.job.id)}>
          <BookmarkCheck className="size-4" />
          {t('discover.view')}
        </Button>
      ) : (
        <Button variant="primary" disabled={saving || !url} onClick={() => void save(job)}>
          <Bookmark className="size-4" />
          {t('discover.save')}
        </Button>
      )}
      {url && (
        <a
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] text-fg-2 hover:bg-fill hover:text-fg"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          {t('discover.open')}
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </>
  );
}
