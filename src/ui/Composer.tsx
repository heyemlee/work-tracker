import clsx from 'clsx';
import { Check, CornerDownLeft, Link2, Plus, SlidersHorizontal, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog, Popover } from 'radix-ui';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRepository } from '../data/store';
import { suggestCompanies } from '../domain/companies';
import { toIsoDate } from '../domain/dates';
import {
  companyFromSlug,
  displayLink,
  findJobByLink,
  findSamePosting,
  parsePosting,
  type Posting,
} from '../domain/postings';
import type { JobRow } from '../domain/rows';
import type { Company, Id, Snapshot } from '../domain/types';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { accountName, channelName, useI18n } from '../i18n/context';
import { liveDefaults, updatePrefs, usePrefs, type LastUsed } from '../state/prefs';
import { showToast } from '../state/toasts';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { CompanyAvatar, IconButton } from './primitives';

type Suggestion = { kind: 'company'; company: Company; jobCount: number } | { kind: 'job'; row: JobRow };

const suggestionKey = (s: Suggestion) => (s.kind === 'company' ? `c:${s.company.id}` : `j:${s.row.job.id}`);

interface ComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: Snapshot;
  rows: JobRow[];
  onOpenJob: (id: Id) => void;
  onOpenSettings: () => void;
}

/**
 * Quick add: a glass panel over the list, opened with N or the toolbar's New button. Built for dozens of entries
 * a day: company → Tab → title → accounts → Enter, or paste the posting's link instead of typing the company.
 * A bottom sheet on phones.
 */
export function Composer({ open, onOpenChange, ...panel }: ComposerProps) {
  const phone = useMediaQuery('(max-width: 767px)');
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-black/25"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <ComposerPanel {...panel} phone={phone} onClose={() => onOpenChange(false)} />
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

interface ComposerPanelProps extends Omit<ComposerProps, 'open' | 'onOpenChange'> {
  phone: boolean;
  onClose: () => void;
}

/**
 * The form. It mounts fresh each time the panel opens, so every entry starts empty; the accounts, channel and
 * resume are remembered from the last one. Picking an existing job from the suggestions attaches more accounts
 * to it instead of creating a duplicate.
 */
function ComposerPanel({ snapshot, rows, onOpenJob, onOpenSettings, phone, onClose }: ComposerPanelProps) {
  const { t } = useI18n();
  const run = useRepository();
  const lastUsed = usePrefs((p) => p.lastUsed);
  const paneRef = useRef<HTMLDivElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: phone ? 28 : 26, bevel: 16 });
  const companyInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);

  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [attachedId, setAttachedId] = useState<Id | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const attached = attachedId ? (rows.find((row) => row.job.id === attachedId) ?? null) : null;
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

  /**
   * A pasted link fills in the company (and, from Workday, the title). A link that's already tracked attaches to
   * its job, so applying to the same posting from another account is paste, Enter.
   */
  function fillFromLink(posting: Posting) {
    closeSuggestions();
    setError(null);
    setLink(posting.url);
    const tracked = findJobByLink(rows, posting.url);
    if (tracked) {
      setAttachedId(tracked.job.id);
      setCompany(tracked.company.name);
      setTitle('');
      requestAnimationFrame(() => submitButton.current?.focus());
      return;
    }
    const name = posting.companySlug ? companyFromSlug(posting.companySlug, snapshot.companies) : '';
    setCompany(name);
    if (posting.title) setTitle(posting.title);
    // Without a company from the link, stay put so it can be typed.
    if (name) titleInput.current?.focus();
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
    if (saving) return;
    const name = (attached?.company.name ?? company).trim();
    if (!name) {
      setError(t('composer.errorCompany'));
      companyInput.current?.focus();
      return;
    }
    const jobTitle = title.trim() || null;
    const target = attached ?? findSamePosting(rows, name, jobTitle, link) ?? null;
    const applied = new Set(target?.applications.map((a) => a.accountId));
    const accountIds = selectedIds.filter((id) => !applied.has(id));

    if (target && accountIds.length === 0) {
      if (selectedIds.length > 0) setError(t('composer.errorAllApplied'));
      else if (attached) setError(t('composer.pickAccount'));
      // Already tracked and nothing to add: show the job instead.
      else onOpenJob(target.job.id);
      return;
    }

    // The panel stays open until the save lands, so a failed save keeps what was typed.
    setSaving(true);
    const result = await run((repo) =>
      repo.quickAdd({
        companyName: name,
        title: target ? null : jobTitle,
        url: link,
        jobId: target?.job.id ?? null,
        accountIds,
        channelId: defaults.channelId,
        resumeId: defaults.resumeId,
        appliedAt: toIsoDate(new Date()),
      }),
    );
    setSaving(false);
    if (!result) return;

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
    onClose();
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
    }
  }

  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submit();
  };

  const field = clsx(
    'w-full min-w-0 rounded-[14px] bg-fill px-4 outline-none transition-colors placeholder:text-fg-3 focus:bg-fill-2',
    // 16px on phones, so iOS doesn't zoom into the field.
    phone ? 'h-12 text-[16px]' : 'h-11 text-[15px]',
  );

  return (
    <Dialog.Content
      asChild
      forceMount
      aria-describedby={undefined}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        companyInput.current?.focus();
      }}
      onEscapeKeyDown={(event) => {
        // The first Escape only closes the suggestions.
        if (!showSuggestions) return;
        event.preventDefault();
        closeSuggestions();
      }}
    >
      {/* Only transforms animate: opacity on an ancestor would cut the glass off from its backdrop. */}
      <motion.div
        className={
          phone
            ? 'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] rounded-t-[28px] outline-none'
            : 'fixed inset-x-0 top-[12dvh] z-50 mx-auto flex max-h-[80dvh] w-[min(580px,calc(100vw-32px))] rounded-[26px] outline-none'
        }
        initial={phone ? { y: '100%' } : { y: -10, scale: 0.97 }}
        animate={phone ? { y: 0 } : { y: 0, scale: 1 }}
        exit={phone ? { y: '100%' } : { y: -8, scale: 0.97, transition: { duration: 0.14 } }}
        transition={{ type: 'spring', bounce: 0.15, duration: 0.38 }}
      >
        <div
          ref={paneRef}
          style={glass.style}
          className="glass glass-strong flex min-h-0 w-full flex-col overflow-hidden rounded-[inherit]"
        >
          {glass.filter}
          <form
            aria-label={t('composer.label')}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className={clsx(
              'scroll-area flex flex-col gap-3 px-5 pt-5',
              phone ? 'pb-[max(20px,env(safe-area-inset-bottom))]' : 'pb-4',
            )}
          >
            <header className="flex items-center justify-between">
              <Dialog.Title className="text-[17px] font-semibold tracking-[-0.01em]">
                {t('composer.label')}
              </Dialog.Title>
              {phone ? (
                <Dialog.Close asChild>
                  <IconButton label={t('detail.close')} className="-mr-2">
                    <X className="size-[18px]" />
                  </IconButton>
                </Dialog.Close>
              ) : (
                <kbd className="kbd">esc</kbd>
              )}
            </header>

            {attached ? (
              <div className="flex items-center gap-3 rounded-[14px] bg-fill p-2 pl-3">
                <CompanyAvatar name={attached.company.name} size={32} />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="text-[12px] text-fg-3">{t('composer.attached')}</div>
                  <div className="truncate text-[15px] font-semibold">
                    {attached.company.name}
                    {attached.job.title && (
                      <span className="font-normal text-fg-2"> · {attached.job.title}</span>
                    )}
                  </div>
                </div>
                <IconButton label={t('composer.detach')} onClick={detach} className="size-8">
                  <X className="size-4" />
                </IconButton>
              </div>
            ) : (
              <>
                <input
                  ref={companyInput}
                  value={company}
                  onChange={(event) => {
                    setCompany(event.target.value);
                    setSuggesting(true);
                    setHighlight(-1);
                    setError(null);
                  }}
                  onPaste={(event) => {
                    const posting = parsePosting(event.clipboardData.getData('text'));
                    if (!posting) return;
                    event.preventDefault();
                    fillFromLink(posting);
                  }}
                  onFocus={() => setSuggesting(true)}
                  onBlur={closeSuggestions}
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
                  className={clsx(field, 'font-medium placeholder:font-normal')}
                />
                {showSuggestions && (
                  <SuggestionList
                    suggestions={suggestions}
                    highlight={highlight}
                    onHighlight={setHighlight}
                    onPick={pick}
                    snapshot={snapshot}
                  />
                )}
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
                  className={field}
                />
              </>
            )}

            {/* The link waiting to be saved; a job that already has one keeps it. */}
            {link && !attached?.job.url && (
              <div className="-mt-1 flex min-w-0 items-center gap-1.5 pl-1 text-[12px] text-fg-2">
                <Link2 className="size-3.5 shrink-0" aria-label={t('composer.link')} />
                <span className="min-w-0 truncate">{displayLink(link)}</span>
                <IconButton
                  label={t('composer.removeLink')}
                  onClick={() => setLink(null)}
                  className="-my-1.5 size-7 text-fg-3"
                >
                  <X className="size-3.5" />
                </IconButton>
              </div>
            )}

            <div>
              <p className="mb-2 px-1 text-[12px] font-semibold text-fg-2">{t('composer.accounts')}</p>
              <div role="group" aria-label={t('composer.accounts')} className="flex flex-wrap gap-1.5">
                {snapshot.accounts.length === 0 && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-fill px-3 text-[14px] font-medium text-fg-2 hover:bg-fill-2 hover:text-fg"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    {t('onboarding.action')}
                  </button>
                )}
                {snapshot.accounts.map((account) => {
                  const done = taken.has(account.id);
                  const on = !done && selectedIds.includes(account.id);
                  const name = accountName(account, t);
                  return (
                    <button
                      key={account.id}
                      type="button"
                      aria-pressed={on}
                      disabled={done}
                      title={done ? t('composer.alreadyApplied', { account: name }) : undefined}
                      onClick={() => toggleAccount(account.id)}
                      onKeyDown={submitOnEnter}
                      className={clsx(
                        'flex h-9 max-w-full min-w-0 items-center gap-2 rounded-full px-3 text-[14px] font-medium transition-all',
                        on ? 'text-fg' : 'bg-fill text-fg-2 hover:bg-fill-2 hover:text-fg',
                        done && 'opacity-45',
                      )}
                      style={
                        on ? { background: 'var(--thumb)', boxShadow: 'var(--thumb-shadow)' } : undefined
                      }
                    >
                      {done ? (
                        <Check className="size-3.5 shrink-0" aria-hidden="true" />
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
                      <span className={clsx('truncate', done && 'line-through')}>{name}</span>
                    </button>
                  );
                })}
              </div>
              {snapshot.accounts.some((account) => !account.email.trim()) && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="mt-2 px-1 text-[12px] font-medium text-fg-2 underline-offset-2 hover:text-fg hover:underline"
                >
                  {t('composer.fillEmails')}
                </button>
              )}
            </div>

            <div className="mt-1 flex items-center gap-2">
              <DefaultsPicker snapshot={snapshot} />
              <button
                ref={submitButton}
                type="submit"
                disabled={saving}
                className={clsx(
                  'ml-auto flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-accent font-semibold text-on-accent transition hover:opacity-90 active:scale-[0.97] disabled:opacity-60',
                  phone ? 'h-12 flex-1 text-[16px]' : 'h-10 pr-3.5 pl-4 text-[14px]',
                )}
              >
                {addCount > 1
                  ? t('composer.addMany', { count: addCount })
                  : addCount === 1 || attached
                    ? t('composer.add')
                    : t('composer.save')}
                {!phone && <CornerDownLeft className="size-3.5 opacity-70" aria-hidden="true" />}
              </button>
            </div>

            {(error || !phone) && (
              <p aria-live="polite" className={clsx('px-1 text-[12px]', error ? 'text-danger' : 'text-fg-3')}>
                {error ?? t('composer.hint')}
              </p>
            )}
          </form>
        </div>
      </motion.div>
    </Dialog.Content>
  );
}

interface SuggestionListProps {
  suggestions: Suggestion[];
  highlight: number;
  onHighlight: (index: number) => void;
  onPick: (suggestion: Suggestion) => void;
  snapshot: Snapshot;
}

function SuggestionList({ suggestions, highlight, onHighlight, onPick, snapshot }: SuggestionListProps) {
  const { t } = useI18n();
  return (
    <div
      id="composer-suggestions"
      role="listbox"
      aria-label={t('composer.company')}
      className="-mt-1 max-h-[min(300px,40dvh)] overflow-y-auto rounded-[16px] bg-fill p-1"
    >
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
            'flex cursor-pointer items-center gap-3 rounded-[12px] px-2.5 py-2',
            index === highlight && 'bg-fill-2',
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
            // A job: its title, then which emails already applied, on a line of their own.
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">
                {suggestion.row.job.title ?? <span className="text-fg-3">{t('composer.untitled')}</span>}
              </span>
              {suggestion.row.applications.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {suggestion.row.applications.map((application) => {
                    const account = snapshot.accounts.find((a) => a.id === application.accountId);
                    return (
                      <span
                        key={application.id}
                        className="chip max-w-full"
                        data-status={application.rejected ? 'rejected' : application.stage}
                      >
                        <span className="truncate font-semibold">
                          {account ? accountName(account, t) : ''}
                        </span>
                        <span className="chip-status">{t(`status.${application.stage}`)}</span>
                      </span>
                    );
                  })}
                </span>
              )}
            </span>
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

/**
 * Channel and resume for new applications, remembered from the last one. Only what's set is shown; picking the
 * selected resume again clears it.
 */
function DefaultsPicker({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useI18n();
  const lastUsed = usePrefs((p) => p.lastUsed);
  const channel = snapshot.channels.find((c) => c.id === lastUsed.channelId);
  const resume = snapshot.resumes.find((r) => r.id === lastUsed.resumeId);
  const set = (patch: Partial<LastUsed>) =>
    updatePrefs((prefs) => ({ lastUsed: { ...prefs.lastUsed, ...patch } }));
  const summary = [channel && channelName(channel, t), resume?.name].filter(Boolean).join(' · ');

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t('composer.defaults')}
          title={t('composer.defaults')}
          className="flex h-9 min-w-0 shrink items-center gap-1.5 rounded-full px-3 text-[13px] text-fg-2 transition-colors hover:bg-fill hover:text-fg"
        >
          <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{summary || t('composer.channel')}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="glass glass-strong z-50 w-64 origin-(--radix-popover-content-transform-origin) rounded-[18px] p-2 outline-none data-[state=open]:animate-[pop-in_160ms_ease-out]"
        >
          <OptionGroup
            label={t('composer.channel')}
            options={snapshot.channels.map((c) => ({ id: c.id, label: channelName(c, t) }))}
            value={lastUsed.channelId}
            onChange={(channelId) => set({ channelId })}
          />
          {snapshot.resumes.length > 0 && (
            <>
              <div className="mx-1 my-2 h-px bg-hairline" />
              <OptionGroup
                label={t('composer.resume')}
                options={snapshot.resumes.map((r) => ({ id: r.id, label: r.name }))}
                value={lastUsed.resumeId}
                onChange={(resumeId) => set({ resumeId: resumeId === lastUsed.resumeId ? null : resumeId })}
              />
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
