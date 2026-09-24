import clsx from 'clsx';
import { Check, ChevronDown, CornerDownLeft, Plus, SlidersHorizontal, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog, Popover } from 'radix-ui';
import { useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { useRepository } from '../data/store';
import { findJob, suggestCompanies } from '../domain/companies';
import { toIsoDate } from '../domain/dates';
import type { JobRow } from '../domain/rows';
import type { Company, Id, Snapshot } from '../domain/types';
import { useHotkey } from '../hooks/useHotkey';
import { channelName, useI18n } from '../i18n/context';
import { liveDefaults, updatePrefs, usePrefs, type LastUsed } from '../state/prefs';
import { showToast } from '../state/toasts';
import { GlassPane } from './glass/GlassPane';
import { CompanyAvatar, IconButton } from './primitives';

type Suggestion = { kind: 'company'; company: Company; jobCount: number } | { kind: 'job'; row: JobRow };

const suggestionKey = (s: Suggestion) => (s.kind === 'company' ? `c:${s.company.id}` : `j:${s.row.job.id}`);

/** Marks the defaults popover, which renders outside the composer but still counts as being in it. */
const IN_COMPOSER = '[data-composer-popover]';

interface ComposerProps {
  snapshot: Snapshot;
  rows: JobRow[];
  onOpenJob: (id: Id) => void;
  onOpenSettings: () => void;
  /** `inline` heads the list and opens up when focused; `sheet` fills a phone's sheet. */
  variant?: 'inline' | 'sheet';
  /** Called once an add is saved. */
  onAdded?: () => void;
}

/**
 * Quick add, built for dozens of entries a day: company → Tab → title → accounts → Enter.
 * Picking an existing job from the suggestions attaches more accounts to it instead of creating a duplicate.
 */
export function Composer({
  snapshot,
  rows,
  onOpenJob,
  onOpenSettings,
  variant = 'inline',
  onAdded,
}: ComposerProps) {
  const { t } = useI18n();
  const run = useRepository();
  const lastUsed = usePrefs((p) => p.lastUsed);
  const companyInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const sheet = variant === 'sheet';

  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [attachedId, setAttachedId] = useState<Id | null>(null);
  const [focused, setFocused] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [error, setError] = useState<string | null>(null);

  useHotkey('n', () => companyInput.current?.focus());

  const attached = attachedId ? (rows.find((row) => row.job.id === attachedId) ?? null) : null;
  // The inline composer is a single field until it's used, then opens up to the rest of the form.
  const expanded = sheet || focused || company !== '' || title !== '' || attached !== null;
  const defaults = liveDefaults(lastUsed, snapshot);
  const selectedIds = defaults.accountIds;
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

  function reset() {
    setCompany('');
    setTitle('');
    setAttachedId(null);
    setError(null);
    closeSuggestions();
  }

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

    // Clear at once so the next entry can start while this one saves; put it back if saving fails.
    reset();
    requestAnimationFrame(() => companyInput.current?.focus());

    const result = await run((repo) =>
      repo.quickAdd({
        companyName: name,
        title: target ? null : jobTitle,
        jobId: target?.job.id ?? null,
        accountIds,
        channelId: defaults.channelId,
        resumeId: defaults.resumeId,
        appliedAt: toIsoDate(new Date()),
      }),
    );
    if (!result) {
      setCompany((current) => current || name);
      setTitle((current) => current || (target ? '' : title));
      setAttachedId((current) => current ?? attached?.job.id ?? null);
      return;
    }

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
    onAdded?.();
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
    } else if (event.key === 'Escape' && showSuggestions) {
      // The first Escape only closes the suggestions.
      event.preventDefault();
      closeSuggestions();
    }
  }

  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submit();
  };

  const companyField = (
    <input
      ref={companyInput}
      value={company}
      autoFocus={sheet}
      onChange={(event) => {
        setCompany(event.target.value);
        setSuggesting(true);
        setHighlight(-1);
        setError(null);
      }}
      onFocus={() => setSuggesting(true)}
      onKeyDown={onCompanyKeyDown}
      placeholder={expanded ? t('composer.company') : t('composer.new')}
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
      className={clsx(
        'min-w-0 font-medium outline-none placeholder:font-normal placeholder:text-fg-3',
        sheet
          ? 'h-12 w-full rounded-[14px] bg-fill px-4 text-[16px] focus:bg-fill-2'
          : 'h-10 flex-[1] bg-transparent text-[15px]',
      )}
    />
  );

  const titleField = (
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
      className={clsx(
        'min-w-0 outline-none placeholder:text-fg-3',
        sheet
          ? 'h-12 w-full rounded-[14px] bg-fill px-4 text-[16px] focus:bg-fill-2'
          : 'h-10 flex-[1.3] bg-transparent text-[15px]',
      )}
    />
  );

  const attachedTarget = attached && (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-1">
      <CompanyAvatar name={attached.company.name} size={30} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[11px] text-fg-3">{t('composer.attached')}</div>
        <div className="truncate text-[14px] font-semibold">
          {attached.company.name}
          {attached.job.title && <span className="font-normal text-fg-2"> · {attached.job.title}</span>}
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
  );

  const accountChips = (
    <div
      role="group"
      aria-label={t('composer.accounts')}
      className={clsx(
        'flex min-w-0 items-center',
        sheet ? 'flex-wrap gap-1.5' : 'flex-1 gap-0.5 overflow-x-auto',
      )}
    >
      {snapshot.accounts.length === 0 && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-fg-2 hover:bg-fill hover:text-fg"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          {t('onboarding.action')}
        </button>
      )}
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
              'flex shrink-0 items-center gap-1.5 rounded-full font-medium transition-all',
              sheet ? 'h-10 px-3.5 text-[15px]' : 'h-8 px-2.5 text-[13px]',
              on ? 'text-fg' : 'text-fg-2 hover:bg-fill hover:text-fg',
              sheet && !on && 'bg-fill',
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
  );

  const submitControl = (
    <button
      ref={submitButton}
      type="submit"
      className={clsx(
        'flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-accent font-semibold text-on-accent transition hover:opacity-90 active:scale-[0.97]',
        sheet ? 'h-12 w-full text-[16px]' : 'h-9 pr-3 pl-3.5 text-[13px]',
      )}
    >
      {addCount > 1
        ? t('composer.addMany', { count: addCount })
        : addCount === 1 || attached
          ? t('composer.add')
          : t('composer.save')}
      {!sheet && <CornerDownLeft className="size-3.5 opacity-70" aria-hidden="true" />}
    </button>
  );

  const suggestionList = (
    <SuggestionList
      suggestions={suggestions}
      highlight={highlight}
      onHighlight={setHighlight}
      onPick={pick}
      snapshot={snapshot}
      className={
        sheet
          ? 'max-h-[40dvh] overflow-y-auto rounded-[14px] bg-fill p-1'
          : 'glass glass-strong mt-2 max-h-[min(360px,50dvh)] overflow-y-auto rounded-[20px] p-1.5'
      }
    />
  );

  const onSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    void submit();
  };

  if (sheet) {
    return (
      <form aria-label={t('composer.label')} onSubmit={onSubmit} className="flex flex-col gap-3">
        {attached ? (
          <div className="rounded-[14px] bg-fill p-2">{attachedTarget}</div>
        ) : (
          <>
            {companyField}
            {showSuggestions && suggestionList}
            {titleField}
          </>
        )}
        <div className="mt-1">
          <p className="mb-2 px-1 text-[12px] font-semibold text-fg-2">{t('composer.accounts')}</p>
          {accountChips}
        </div>
        <DefaultsPicker snapshot={snapshot} variant="sheet" />
        {error && (
          <p aria-live="polite" className="px-1 text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="mt-1">{submitControl}</div>
      </form>
    );
  }

  const leaves = (event: FocusEvent) => {
    const next = event.relatedTarget;
    return !(
      next instanceof Node &&
      (event.currentTarget.contains(next) || (next instanceof Element && next.closest(IN_COMPOSER) !== null))
    );
  };

  return (
    <div
      className="relative z-20"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!leaves(event)) return;
        setFocused(false);
        closeSuggestions();
      }}
      onKeyDown={(event) => {
        // Escape cancels the entry, unless something inside (the suggestions) already used it.
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        if (!event.currentTarget.contains(event.target as Node)) return;
        reset();
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <form
        aria-label={t('composer.label')}
        onSubmit={onSubmit}
        onMouseDown={(event) => {
          // A click anywhere on the closed bar starts typing a company.
          if (expanded || (event.target instanceof Element && event.target.closest('input, button'))) return;
          event.preventDefault();
          companyInput.current?.focus();
        }}
        className={clsx(
          'rounded-[18px] transition-[background-color,box-shadow] duration-200',
          expanded ? 'bg-surface shadow-[var(--card-shadow)]' : 'cursor-text bg-fill hover:bg-fill-2',
        )}
      >
        <div className="flex h-12 items-center pr-2 pl-1.5">
          {attached ? (
            attachedTarget
          ) : (
            <>
              <Plus className="pointer-events-none mx-2 size-[18px] shrink-0 text-fg-3" aria-hidden="true" />
              {companyField}
              {expanded ? (
                <>
                  <span className="mx-2 h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />
                  {titleField}
                </>
              ) : (
                <kbd className="kbd pointer-events-none mr-1">N</kbd>
              )}
            </>
          )}
        </div>
        {/* The rest of the form opens below the field; rows animate in without measuring the content. */}
        <div
          inert={!expanded}
          className={clsx(
            'grid transition-[grid-template-rows] duration-200 ease-out',
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex items-center gap-1 border-t border-hairline px-2 py-2">
              {accountChips}
              <DefaultsPicker snapshot={snapshot} variant="inline" />
              {submitControl}
            </div>
          </div>
        </div>
      </form>

      <AnimatePresence>
        {showSuggestions && (
          <motion.div
            className="absolute inset-x-0 top-full"
            initial={{ y: -6, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
          >
            {suggestionList}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={clsx(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded || error ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <p
            aria-live="polite"
            className={clsx('px-3 pt-2 text-[12px]', error ? 'text-danger' : 'text-fg-3')}
          >
            {error ?? t('composer.hint')}
          </p>
        </div>
      </div>
    </div>
  );
}

interface ComposerSheetProps extends Omit<ComposerProps, 'variant' | 'onAdded'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Adding on a phone: the composer in a glass bottom sheet, opened from the top bar's plus button. */
export function ComposerSheet({ open, onOpenChange, onOpenJob, ...composer }: ComposerSheetProps) {
  const { t } = useI18n();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-black/30"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] rounded-t-[28px] outline-none"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', bounce: 0.1, duration: 0.42 }}
              >
                <GlassPane
                  radius={28}
                  bevel={18}
                  className="glass-strong flex min-h-0 w-full flex-col overflow-hidden rounded-[inherit]"
                >
                  <header className="flex items-center justify-between px-5 pt-5 pb-3">
                    <Dialog.Title className="text-[20px] font-semibold tracking-[-0.02em]">
                      {t('composer.label')}
                    </Dialog.Title>
                    <Dialog.Close asChild>
                      <IconButton label={t('detail.close')} className="-mr-2">
                        <X className="size-[18px]" />
                      </IconButton>
                    </Dialog.Close>
                  </header>
                  <div className="scroll-area px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
                    <Composer
                      {...composer}
                      variant="sheet"
                      onAdded={() => onOpenChange(false)}
                      onOpenJob={(id) => {
                        onOpenChange(false);
                        onOpenJob(id);
                      }}
                    />
                  </div>
                </GlassPane>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

interface SuggestionListProps {
  suggestions: Suggestion[];
  highlight: number;
  onHighlight: (index: number) => void;
  onPick: (suggestion: Suggestion) => void;
  snapshot: Snapshot;
  className: string;
}

function SuggestionList({
  suggestions,
  highlight,
  onHighlight,
  onPick,
  snapshot,
  className,
}: SuggestionListProps) {
  const { t } = useI18n();
  return (
    <div id="composer-suggestions" role="listbox" aria-label={t('composer.company')} className={className}>
      {suggestions.map((suggestion, index) => (
        <div
          key={suggestionKey(suggestion)}
          id={`composer-suggestion-${index}`}
          role="option"
          aria-selected={index === highlight}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHighlight(index)}
          onClick={() => onPick(suggestion)}
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
                {suggestion.row.job.title ?? <span className="text-fg-3">{t('composer.untitled')}</span>}
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
function DefaultsPicker({ snapshot, variant }: { snapshot: Snapshot; variant: 'inline' | 'sheet' }) {
  const { t } = useI18n();
  const lastUsed = usePrefs((p) => p.lastUsed);
  const channel = snapshot.channels.find((c) => c.id === lastUsed.channelId);
  const resume = snapshot.resumes.find((r) => r.id === lastUsed.resumeId);
  const set = (patch: Partial<LastUsed>) =>
    updatePrefs((prefs) => ({ lastUsed: { ...prefs.lastUsed, ...patch } }));
  const summary = `${channel ? channelName(channel, t) : t('composer.none')} · ${resume?.name ?? t('composer.none')}`;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        {variant === 'sheet' ? (
          <button
            type="button"
            className="flex h-12 w-full items-center gap-2.5 rounded-[14px] bg-fill px-4 text-left text-[15px]"
          >
            <SlidersHorizontal className="size-4 shrink-0 text-fg-2" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{summary}</span>
            <ChevronDown className="size-4 shrink-0 text-fg-3" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={t('composer.defaults')}
            title={t('composer.defaults')}
            className="flex h-8 min-w-0 shrink items-center gap-1.5 rounded-full px-2.5 text-[12px] text-fg-2 transition-colors hover:bg-fill hover:text-fg"
          >
            <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate max-lg:hidden">{summary}</span>
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-composer-popover=""
          side={variant === 'sheet' ? 'top' : 'bottom'}
          align="end"
          sideOffset={10}
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
