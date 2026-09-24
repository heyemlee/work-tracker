import clsx from 'clsx';
import { Check, CornerDownLeft, Plus, SlidersHorizontal, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Popover } from 'radix-ui';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRepository } from '../data/store';
import { findJob, suggestCompanies } from '../domain/companies';
import { toIsoDate } from '../domain/dates';
import type { JobRow } from '../domain/rows';
import type { Company, Id, Snapshot } from '../domain/types';
import { useHotkey } from '../hooks/useHotkey';
import { channelName, useI18n } from '../i18n/context';
import { updatePrefs, usePrefs, type LastUsed } from '../state/prefs';
import { showToast } from '../state/toasts';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { CompanyAvatar } from './primitives';
import { Toaster } from './Toaster';

type Suggestion = { kind: 'company'; company: Company; jobCount: number } | { kind: 'job'; row: JobRow };

const suggestionKey = (s: Suggestion) => (s.kind === 'company' ? `c:${s.company.id}` : `j:${s.row.job.id}`);

interface ComposerProps {
  snapshot: Snapshot;
  rows: JobRow[];
  onOpenJob: (id: Id) => void;
}

/**
 * Quick add, built for dozens of entries a day: company → Tab → title → accounts → Enter.
 * Picking an existing job from the suggestions attaches more accounts to it instead of creating a duplicate.
 */
export function Composer({ snapshot, rows, onOpenJob }: ComposerProps) {
  const { t } = useI18n();
  const run = useRepository();
  const lastUsed = usePrefs((p) => p.lastUsed);
  const formRef = useRef<HTMLFormElement>(null);
  const glass = useLiquidGlass(formRef, { radius: 26, bevel: 16 });
  const companyInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);

  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [attachedId, setAttachedId] = useState<Id | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [error, setError] = useState<string | null>(null);

  useHotkey('n', () => companyInput.current?.focus());

  const attached = attachedId ? (rows.find((row) => row.job.id === attachedId) ?? null) : null;
  const selectedIds = snapshot.accounts.filter((a) => lastUsed.accountIds.includes(a.id)).map((a) => a.id);
  const taken = new Set(attached?.applications.map((a) => a.accountId));
  const addCount = selectedIds.filter((id) => !taken.has(id)).length;

  const suggestions = useMemo<Suggestion[]>(() => {
    if (attachedId || !company.trim()) return [];
    return suggestCompanies(company, rows, snapshot.companies).flatMap(({ company: match, jobs }) => [
      { kind: 'company' as const, company: match, jobCount: jobs.length },
      ...jobs.slice(0, 3).map((row) => ({ kind: 'job' as const, row })),
    ]);
  }, [attachedId, company, rows, snapshot.companies]);
  const showSuggestions = suggesting && suggestions.length > 0;

  const closeSuggestions = () => {
    setSuggesting(false);
    setHighlight(-1);
  };

  function pick(suggestion: Suggestion) {
    closeSuggestions();
    setError(null);
    if (suggestion.kind === 'company') {
      setCompany(suggestion.company.name);
      titleInput.current?.focus();
      return;
    }
    setAttachedId(suggestion.row.job.id);
    setCompany(suggestion.row.company.name);
    setTitle('');
    requestAnimationFrame(() => submitButton.current?.focus());
  }

  function detach() {
    setAttachedId(null);
    requestAnimationFrame(() => titleInput.current?.focus());
  }

  function toggleAccount(id: Id) {
    setError(null);
    updatePrefs((prefs) => {
      const ids = prefs.lastUsed.accountIds;
      return {
        lastUsed: {
          ...prefs.lastUsed,
          accountIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
        },
      };
    });
  }

  async function submit() {
    const name = (attached?.company.name ?? company).trim();
    if (!name) {
      setError(t('composer.errorCompany'));
      companyInput.current?.focus();
      return;
    }
    const jobTitle = title.trim() || null;
    const target = attached ?? findJob(rows, name, jobTitle) ?? null;
    const applied = new Set(target?.applications.map((a) => a.accountId));
    const accountIds = selectedIds.filter((id) => !applied.has(id));

    if (target && accountIds.length === 0) {
      if (selectedIds.length > 0) setError(t('composer.errorAllApplied'));
      else if (attached) setError(t('composer.pickAccount'));
      else {
        setError(t('composer.exists'));
        onOpenJob(target.job.id);
      }
      return;
    }

    const result = await run((repo) =>
      repo.quickAdd({
        companyName: name,
        title: target ? null : jobTitle,
        jobId: target?.job.id ?? null,
        accountIds,
        channelId: lastUsed.channelId,
        resumeId: lastUsed.resumeId,
        appliedAt: toIsoDate(new Date()),
      }),
    );

    const message =
      accountIds.length === 0
        ? t('toast.saved', { company: name })
        : accountIds.length === 1
          ? t('toast.added', { company: name })
          : t('toast.addedMany', { company: name, count: accountIds.length });
    showToast({
      message,
      action: { label: t('toast.undo'), run: () => void run((repo) => repo.undoQuickAdd(result)) },
    });

    setCompany('');
    setTitle('');
    setAttachedId(null);
    setError(null);
    closeSuggestions();
    requestAnimationFrame(() => companyInput.current?.focus());
  }

  function onCompanyKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const count = suggestions.length;
    if (event.key === 'ArrowDown' && count > 0) {
      event.preventDefault();
      setSuggesting(true);
      setHighlight((h) => (h + 1) % count);
    } else if (event.key === 'ArrowUp' && count > 0) {
      event.preventDefault();
      setSuggesting(true);
      setHighlight((h) => (h <= 0 ? count - 1 : h - 1));
    } else if (event.key === 'Enter' && showSuggestions && highlight >= 0) {
      event.preventDefault();
      const suggestion = suggestions[highlight];
      if (suggestion) pick(suggestion);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (showSuggestions) closeSuggestions();
      else event.currentTarget.blur();
    }
  }

  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submit();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 pr-[calc(var(--reserve,0px)+12px)] pb-[max(12px,env(safe-area-inset-bottom))] pl-3 transition-[padding] duration-300 ease-out sm:pr-[calc(var(--reserve,0px)+20px)] sm:pl-5">
      <div
        className="group pointer-events-auto relative mx-auto max-w-[820px]"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) closeSuggestions();
        }}
      >
        <Toaster />

        <AnimatePresence>
          {showSuggestions && (
            <motion.div
              id="composer-suggestions"
              role="listbox"
              aria-label={t('composer.company')}
              initial={{ y: 8, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 6, scale: 0.98, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
              className="glass glass-strong absolute inset-x-0 bottom-full mb-2 max-h-[min(360px,50dvh)] overflow-y-auto rounded-[22px] p-1.5"
            >
              {suggestions.map((suggestion, index) => (
                <div
                  key={suggestionKey(suggestion)}
                  id={`composer-suggestion-${index}`}
                  role="option"
                  aria-selected={index === highlight}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => pick(suggestion)}
                  className={clsx(
                    'flex cursor-pointer items-center gap-3 rounded-[14px] px-2.5 py-2',
                    index === highlight && 'bg-fill',
                    suggestion.kind === 'job' && 'pl-[52px]',
                  )}
                >
                  {suggestion.kind === 'company' ? (
                    <>
                      <CompanyAvatar name={suggestion.company.name} size={28} />
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                        {suggestion.company.name}
                      </span>
                      {suggestion.jobCount > 0 && (
                        <span className="shrink-0 text-[12px] text-fg-3">
                          {t('composer.jobCount', { count: suggestion.jobCount })}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {suggestion.row.job.title ?? (
                          <span className="text-fg-3">{t('composer.untitled')}</span>
                        )}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        {suggestion.row.applications.map((application) => {
                          const account = snapshot.accounts.find((a) => a.id === application.accountId);
                          return (
                            <span
                              key={application.id}
                              className="chip"
                              data-status={application.rejected ? 'rejected' : application.stage}
                            >
                              <span className="font-semibold">{account?.label}</span>
                              <span className="chip-status">{t(`status.${application.stage}`)}</span>
                            </span>
                          );
                        })}
                      </span>
                    </>
                  )}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <form
          ref={formRef}
          style={glass.style}
          aria-label={t('composer.label')}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="glass flex flex-wrap items-center gap-x-1 gap-y-1.5 rounded-[26px] p-2 md:flex-nowrap"
        >
          {glass.filter}

          {attached ? (
            <div className="flex min-w-0 flex-1 basis-full items-center gap-2.5 pl-1 md:basis-0">
              <CompanyAvatar name={attached.company.name} size={30} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-[11px] text-fg-3">{t('composer.attached')}</div>
                <div className="truncate text-[14px] font-semibold">
                  {attached.company.name}
                  {attached.job.title && (
                    <span className="font-normal text-fg-2"> · {attached.job.title}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                aria-label={t('composer.detach')}
                title={t('composer.detach')}
                onClick={detach}
                className="grid size-8 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-fill hover:text-fg"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 basis-full items-center md:basis-0">
              <Plus className="mx-2 size-[18px] shrink-0 text-fg-3" aria-hidden="true" />
              <input
                ref={companyInput}
                value={company}
                onChange={(event) => {
                  setCompany(event.target.value);
                  setSuggesting(true);
                  setHighlight(-1);
                  setError(null);
                }}
                onFocus={() => setSuggesting(true)}
                onKeyDown={onCompanyKeyDown}
                placeholder={t('composer.company')}
                aria-label={t('composer.company')}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
                aria-controls="composer-suggestions"
                aria-activedescendant={
                  showSuggestions && highlight >= 0 ? `composer-suggestion-${highlight}` : undefined
                }
                autoComplete="off"
                spellCheck={false}
                className="h-10 min-w-0 flex-[1] bg-transparent text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-fg-3"
              />
              <span className="mx-2 h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />
              <input
                ref={titleInput}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setError(null);
                }}
                placeholder={t('composer.title')}
                aria-label={t('composer.title')}
                autoComplete="off"
                className="h-10 min-w-0 flex-[1.3] bg-transparent text-[15px] outline-none placeholder:text-fg-3"
              />
            </div>
          )}

          <div className="flex min-w-0 items-center gap-1 max-md:w-full">
            <div
              role="group"
              aria-label={t('composer.accounts')}
              className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex-none"
            >
              {snapshot.accounts.map((account) => {
                const done = taken.has(account.id);
                const on = !done && selectedIds.includes(account.id);
                return (
                  <button
                    key={account.id}
                    type="button"
                    aria-pressed={on}
                    disabled={done}
                    title={done ? t('composer.alreadyApplied', { account: account.label }) : account.email}
                    onClick={() => toggleAccount(account.id)}
                    onKeyDown={submitOnEnter}
                    className={clsx(
                      'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition-all',
                      on ? 'text-fg' : 'text-fg-2 hover:bg-fill hover:text-fg',
                      done && 'opacity-45',
                    )}
                    style={on ? { background: 'var(--thumb)', boxShadow: 'var(--thumb-shadow)' } : undefined}
                  >
                    {done ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : (
                      <span
                        className="dot transition-transform"
                        style={{
                          background: `var(--acc-${account.color})`,
                          transform: on ? 'scale(1.15)' : 'scale(0.85)',
                          opacity: on ? 1 : 0.55,
                        }}
                      />
                    )}
                    <span className={clsx(done && 'line-through')}>{account.label}</span>
                  </button>
                );
              })}
            </div>

            <DefaultsPicker snapshot={snapshot} />

            <button
              ref={submitButton}
              type="submit"
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent pr-3 pl-3.5 text-[13px] font-semibold text-on-accent transition hover:opacity-90 active:scale-[0.97]"
            >
              {addCount > 1
                ? t('composer.addMany', { count: addCount })
                : addCount === 1 || attached
                  ? t('composer.add')
                  : t('composer.save')}
              <CornerDownLeft className="size-3.5 opacity-70" aria-hidden="true" />
            </button>
          </div>
        </form>

        {/* Errors always show; the shortcut hint only while the composer has focus. */}
        <p
          aria-live="polite"
          className={clsx(
            'glass glass-strong mx-auto mt-2 w-fit rounded-full px-3 py-1 text-[11px]',
            error ? 'text-danger' : 'hidden text-fg-2 sm:group-focus-within:block',
          )}
        >
          {error ?? t('composer.hint')}
        </p>
      </div>
    </div>
  );
}

interface Option {
  id: Id | null;
  label: string;
}

function OptionGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option[];
  value: Id | null;
  onChange: (id: Id | null) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      <p className="px-2 pt-1 pb-1.5 text-[12px] font-semibold text-fg-2">{label}</p>
      {options.map((option) => (
        <button
          key={option.id ?? 'none'}
          type="button"
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
          className="flex w-full items-center justify-between rounded-[10px] px-2 py-1.5 text-left text-[14px] hover:bg-fill"
        >
          {option.label}
          {option.id === value && <Check className="size-4 text-fg-2" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

/** Channel and resume for new applications. Defaults to whatever was used last. */
function DefaultsPicker({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useI18n();
  const lastUsed = usePrefs((p) => p.lastUsed);
  const channel = snapshot.channels.find((c) => c.id === lastUsed.channelId);
  const resume = snapshot.resumes.find((r) => r.id === lastUsed.resumeId);
  const set = (patch: Partial<LastUsed>) =>
    updatePrefs((prefs) => ({ lastUsed: { ...prefs.lastUsed, ...patch } }));

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t('composer.defaults')}
          title={t('composer.defaults')}
          className="flex h-8 min-w-0 shrink items-center gap-1.5 rounded-full px-2.5 text-[12px] text-fg-2 transition-colors hover:bg-fill hover:text-fg"
        >
          <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate max-lg:hidden">
            {channel ? channelName(channel, t) : t('composer.none')} · {resume?.name ?? t('composer.none')}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={14}
          collisionPadding={12}
          className="glass glass-strong z-50 w-64 origin-(--radix-popover-content-transform-origin) rounded-[18px] p-2 outline-none data-[state=open]:animate-[pop-in_160ms_ease-out]"
        >
          <OptionGroup
            label={t('composer.channel')}
            options={snapshot.channels.map((c) => ({ id: c.id, label: channelName(c, t) }))}
            value={lastUsed.channelId}
            onChange={(channelId) => set({ channelId })}
          />
          <div className="mx-1 my-2 h-px bg-hairline" />
          <OptionGroup
            label={t('composer.resume')}
            options={[
              { id: null, label: t('composer.none') },
              ...snapshot.resumes.map((r) => ({ id: r.id, label: r.name })),
            ]}
            value={lastUsed.resumeId}
            onChange={(resumeId) => set({ resumeId })}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
