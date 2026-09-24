import clsx from 'clsx';
import { MousePointerClick, Plus, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { patchApplication, useJobEvents, useRepository } from '../data/store';
import { indexBy } from '../domain/collections';
import type { JobRow, Stats } from '../domain/rows';
import {
  STAGES,
  type Account,
  type Application,
  type Channel,
  type Id,
  type IsoDate,
  type ResumeVersion,
  type Snapshot,
  type TimelineEvent,
} from '../domain/types';
import { useHotkey } from '../hooks/useHotkey';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { channelName, useI18n } from '../i18n/context';
import { formatDateTime, formatShortDate } from '../i18n/format';
import { getPrefs, liveDefaults } from '../state/prefs';
import { showToast } from '../state/toasts';
import { GlassPane } from './glass/GlassPane';
import { Button, CompanyAvatar, IconButton, Section, Switch } from './primitives';
import { SegmentedControl } from './SegmentedControl';
import { StatsRow } from './StatsRow';

interface DetailPanelProps {
  row: JobRow | null;
  snapshot: Snapshot;
  today: IsoDate;
  onClose: () => void;
}

/**
 * The selected job, sliding over the list where there is no room beside it: a glass side panel that leaves the
 * list usable on medium screens, a bottom sheet on phones.
 */
export function DetailPanel({ row, snapshot, today, onClose }: DetailPanelProps) {
  const mobile = useMediaQuery('(max-width: 767px)');
  const drag = useDragControls();

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  return (
    <Dialog.Root open={row !== null} onOpenChange={(open) => !open && onClose()} modal={mobile}>
      <AnimatePresence>
        {row && (
          <Dialog.Portal forceMount>
            {mobile && (
              <Dialog.Overlay asChild forceMount>
                <motion.div
                  className="fixed inset-0 z-40 bg-black/30"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                />
              </Dialog.Overlay>
            )}
            <Dialog.Content
              asChild
              forceMount
              aria-describedby={undefined}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onEscapeKeyDown={(event) => {
                // Escape while editing a field finishes the edit instead of closing the panel.
                const active = document.activeElement;
                if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
                  event.preventDefault();
                  active.blur();
                }
              }}
              onInteractOutside={(event) => {
                // Clicking another row switches jobs rather than closing the panel.
                const target = event.target;
                if (target instanceof Element && target.closest('[data-job-row], [data-keep-panel]')) {
                  event.preventDefault();
                }
              }}
            >
              {/* Only transforms animate: opacity on an ancestor would cut the glass off from its backdrop. */}
              <motion.aside
                className={
                  mobile
                    ? 'fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] rounded-t-[28px] outline-none'
                    : 'fixed top-3 right-3 bottom-3 z-40 flex w-[420px] rounded-[28px] outline-none'
                }
                initial={mobile ? { y: '100%' } : { x: 460 }}
                animate={mobile ? { y: 0 } : { x: 0 }}
                exit={mobile ? { y: '100%' } : { x: 460 }}
                transition={{ type: 'spring', bounce: 0.1, duration: 0.42 }}
                drag={mobile ? 'y' : false}
                dragListener={false}
                dragControls={drag}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.7 }}
                onDragEnd={onDragEnd}
              >
                <GlassPane
                  radius={28}
                  bevel={18}
                  className="flex min-h-0 w-full flex-col overflow-hidden rounded-[inherit]"
                >
                  <Dialog.Title className="sr-only">{row.company.name}</Dialog.Title>
                  <JobDetails
                    key={row.job.id}
                    row={row}
                    snapshot={snapshot}
                    today={today}
                    onClose={onClose}
                    onGrab={mobile ? (event) => drag.start(event) : undefined}
                  />
                </GlassPane>
              </motion.aside>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

interface DetailPaneProps extends DetailPanelProps {
  stats: Stats;
}

/** Beside the list on wide screens: the selected job, or the day's numbers while nothing is selected. */
export function DetailPane({ row, snapshot, today, stats, onClose }: DetailPaneProps) {
  const { t } = useI18n();
  useHotkey('escape', () => {
    // Escape closing a dialog shouldn't also close the job behind it.
    if (!document.querySelector('[role="dialog"]')) onClose();
  });

  return (
    <aside
      aria-label={row ? row.company.name : t('overview.label')}
      className="card flex w-[400px] shrink-0 flex-col overflow-hidden rounded-[24px]"
    >
      {row ? (
        <JobDetails key={row.job.id} row={row} snapshot={snapshot} today={today} onClose={onClose} />
      ) : (
        <div className="flex flex-1 flex-col px-6 pt-6">
          <StatsRow stats={stats} today={today} columns={2} />
          <p className="mt-10 flex items-center gap-2 text-[13px] text-fg-3">
            <MousePointerClick className="size-4 shrink-0" aria-hidden="true" />
            {t('overview.hint')}
          </p>
        </div>
      )}
    </aside>
  );
}

interface JobDetailsProps {
  row: JobRow;
  snapshot: Snapshot;
  today: IsoDate;
  onClose: () => void;
  onGrab?: (event: PointerEvent) => void;
}

function JobDetails({ row, snapshot, today, onClose, onGrab }: JobDetailsProps) {
  const { t } = useI18n();
  const run = useRepository();
  const accountsById = useMemo(() => indexBy(snapshot.accounts, (a) => a.id), [snapshot.accounts]);
  const available = snapshot.accounts.filter(
    (account) => !row.applications.some((a) => a.accountId === account.id),
  );
  const events = useJobEvents(row.job.id).data ?? [];

  const addApplication = (account: Account) => {
    const { channelId, resumeId } = liveDefaults(getPrefs().lastUsed, snapshot);
    void run((repo) =>
      repo.addApplication({
        jobId: row.job.id,
        accountId: account.id,
        channelId,
        resumeId,
        appliedAt: today,
      }),
    );
  };

  return (
    <>
      {onGrab && (
        <div onPointerDown={onGrab} className="flex cursor-grab touch-none justify-center pt-2.5 pb-1">
          <span className="h-1.5 w-10 rounded-full bg-fill-2" />
        </div>
      )}

      <header className="flex items-start gap-3 px-5 pt-5 pb-3">
        <CompanyAvatar name={row.company.name} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[22px] leading-tight font-semibold tracking-[-0.02em]">
            {row.company.name}
          </h2>
          <TitleField
            value={row.job.title}
            onCommit={(title) => void run((repo) => repo.updateJob(row.job.id, { title }))}
          />
        </div>
        <IconButton label={t('detail.close')} onClick={onClose} className="-mt-1 -mr-2">
          <X className="size-[18px]" />
        </IconButton>
      </header>

      <div className="scroll-area min-h-0 flex-1 px-5 pt-2 pb-6">
        <Section title={t('detail.applications')}>
          <div className="space-y-2">
            {row.applications.map((application) => (
              <ApplicationCard
                key={application.id}
                application={application}
                account={accountsById.get(application.accountId)}
                channels={snapshot.channels}
                resumes={snapshot.resumes}
              />
            ))}
          </div>
          {available.length > 0 && (
            <div className={clsx(row.applications.length > 0 && 'mt-3')}>
              <p className="mb-2 text-[12px] text-fg-2">
                {row.applications.length > 0 ? t('detail.applyWith') : t('detail.markApplied')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {available.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => addApplication(account)}
                    className="flex h-8 items-center gap-1.5 rounded-full bg-fill pr-3 pl-2.5 text-[13px] font-medium transition hover:bg-fill-2 active:scale-[0.97]"
                  >
                    <Plus className="size-3.5 text-fg-2" aria-hidden="true" />
                    <span className="dot" style={{ background: `var(--acc-${account.color})` }} />
                    {account.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Section>

        <Section title={t('detail.notes')}>
          <NotesField
            value={row.job.notes}
            placeholder={t('detail.notesPlaceholder')}
            onCommit={(notes) => void run((repo) => repo.updateJob(row.job.id, { notes }))}
          />
        </Section>

        <Section title={t('detail.timeline')}>
          <Timeline events={events} accountsById={accountsById} />
        </Section>

        <DeleteJob row={row} onDeleted={onClose} />
      </div>
    </>
  );
}

function TitleField({ value, onCommit }: { value: string | null; onCommit: (title: string | null) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value ?? '');
  const commit = () => {
    const next = draft.trim() || null;
    if (next !== value) onCommit(next);
  };
  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      placeholder={t('detail.titlePlaceholder')}
      aria-label={t('detail.titlePlaceholder')}
      className="mt-0.5 w-full bg-transparent text-[15px] text-fg-2 outline-none placeholder:text-fg-3 focus:text-fg"
    />
  );
}

/** Saves on blur, and on unmount so switching jobs never drops a draft. */
function NotesField({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (notes: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const latest = useRef({ draft, value, onCommit });
  useEffect(() => {
    latest.current = { draft, value, onCommit };
  });
  useEffect(
    () => () => {
      const pending = latest.current;
      if (pending.draft !== pending.value) pending.onCommit(pending.draft);
    },
    [],
  );

  return (
    <textarea
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      placeholder={placeholder}
      rows={3}
      className="min-h-[84px] w-full resize-none rounded-[14px] bg-fill px-3 py-2.5 text-[14px] leading-relaxed outline-none [field-sizing:content] placeholder:text-fg-3 focus:bg-fill-2"
    />
  );
}

interface ApplicationCardProps {
  application: Application;
  account: Account | undefined;
  channels: Channel[];
  resumes: ResumeVersion[];
}

function ApplicationCard({ application, account, channels, resumes }: ApplicationCardProps) {
  const { t, locale } = useI18n();
  const run = useRepository();
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!confirmRemove) return;
    const timer = setTimeout(() => setConfirmRemove(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmRemove]);

  const update = (patch: { channelId?: Id | null; resumeId?: Id | null }) =>
    void run((repo) => repo.updateApplication(application.id, patch));

  return (
    <div className="rounded-[16px] bg-fill p-3">
      <div className={clsx('flex items-center gap-2', application.rejected && 'opacity-60')}>
        <span className="dot" style={{ background: `var(--acc-${account?.color ?? 'gray'})` }} />
        <span className="text-[14px] font-semibold">{account?.label ?? t('event.unknownAccount')}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{account?.email}</span>
        <span className="shrink-0 text-[12px] text-fg-3">
          {t('detail.appliedOn', { date: formatShortDate(application.appliedAt, locale) })}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          size="sm"
          segments={STAGES.map((stage) => ({ value: stage, label: t(`status.${stage}`) }))}
          value={application.stage}
          onChange={(stage) =>
            void run((repo) => repo.setStage(application.id, stage), {
              optimistic: patchApplication(application.id, { stage }),
            })
          }
          label={account?.label ?? t('detail.applications')}
          layoutId={`stage-${application.id}`}
          className={clsx(application.rejected && 'opacity-60')}
        />
        <label className="flex items-center gap-2 text-[13px] text-fg-2">
          {t('detail.rejected')}
          <Switch
            checked={application.rejected}
            onCheckedChange={(rejected) =>
              void run((repo) => repo.setRejected(application.id, rejected), {
                optimistic: patchApplication(application.id, { rejected }),
              })
            }
          />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <select
          className="select min-w-0"
          aria-label={t('detail.channel')}
          value={application.channelId ?? ''}
          onChange={(event) => update({ channelId: event.target.value || null })}
        >
          <option value="">
            {t('detail.channel')}: {t('composer.none')}
          </option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channelName(channel, t)}
            </option>
          ))}
        </select>
        <select
          className="select min-w-0"
          aria-label={t('detail.resume')}
          value={application.resumeId ?? ''}
          onChange={(event) => update({ resumeId: event.target.value || null })}
        >
          <option value="">
            {t('detail.resume')}: {t('composer.none')}
          </option>
          {resumes.map((resume) => (
            <option key={resume.id} value={resume.id}>
              {resume.name}
            </option>
          ))}
        </select>
        {confirmRemove ? (
          <Button
            variant="danger"
            className="ml-auto h-7 px-3 text-[12px]"
            onClick={() => void run((repo) => repo.removeApplication(application.id))}
          >
            {t('detail.remove')}
          </Button>
        ) : (
          <IconButton
            label={t('detail.remove')}
            onClick={() => setConfirmRemove(true)}
            className="ml-auto size-8 text-fg-3 hover:text-danger"
          >
            <Trash2 className="size-4" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

const EVENT_COLORS: Record<TimelineEvent['type'], string> = {
  job_created: 'var(--fg-3)',
  applied: 'var(--st-applied)',
  stage_changed: 'var(--st-oa)',
  rejected: 'var(--st-rejected)',
  unrejected: 'var(--st-applied)',
  application_removed: 'var(--fg-3)',
};

function Timeline({ events, accountsById }: { events: TimelineEvent[]; accountsById: Map<Id, Account> }) {
  const { t, locale } = useI18n();

  const describe = (event: TimelineEvent) => {
    const account = event.accountId ? accountsById.get(event.accountId)?.label : undefined;
    const vars = {
      account: account ?? t('event.unknownAccount'),
      stage: event.to ? t(`status.${event.to}`) : '',
    };
    return t(`event.${event.type}`, vars);
  };

  const color = (event: TimelineEvent) =>
    event.type === 'stage_changed' && event.to ? `var(--st-${event.to})` : EVENT_COLORS[event.type];

  return (
    <ol className="relative space-y-3.5 pl-5">
      <span aria-hidden="true" className="absolute top-2 bottom-2 left-[3px] w-px bg-hairline" />
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span className="dot absolute top-[6px] -left-5" style={{ background: color(event) }} />
          <p className="text-[13px]">
            {describe(event)}
            {event.actor === 'agent' && <span className="ml-1.5 text-[11px] text-fg-3">Agent</span>}
          </p>
          <p className="text-[12px] text-fg-3">{formatDateTime(event.at, locale)}</p>
        </li>
      ))}
    </ol>
  );
}

function DeleteJob({ row, onDeleted }: { row: JobRow; onDeleted: () => void }) {
  const { t } = useI18n();
  const run = useRepository();
  const [confirming, setConfirming] = useState(false);

  const remove = async () => {
    const jobId = row.job.id;
    await run((repo) => repo.deleteJob(jobId));
    onDeleted();
    showToast({
      message: t('toast.deleted', { company: row.company.name }),
      action: { label: t('toast.undo'), run: () => void run((repo) => repo.restoreJob(jobId)) },
    });
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-8 text-[13px] font-medium text-danger hover:underline"
      >
        {t('detail.delete')}
      </button>
    );
  }

  return (
    <div className="mt-8 rounded-[16px] bg-fill p-3">
      <p className="text-[13px]">{t('detail.confirmDelete')}</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={() => setConfirming(false)}>{t('detail.cancel')}</Button>
        <Button variant="danger" onClick={() => void remove()}>
          {t('detail.confirm')}
        </Button>
      </div>
    </div>
  );
}
