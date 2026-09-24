import clsx from 'clsx';
import { Download, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog, Popover } from 'radix-ui';
import { useMemo, useRef, type ReactNode } from 'react';
import { useRepository } from '../data/store';
import { toCsv } from '../domain/csv';
import { toIsoDate } from '../domain/dates';
import { ACCOUNT_COLORS, type Account, type AccountColor, type Snapshot } from '../domain/types';
import { channelName, useI18n } from '../i18n/context';
import { updatePrefs, usePrefs, type Locale, type ThemePref } from '../state/prefs';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { Button, IconButton, Switch } from './primitives';
import { SegmentedControl } from './SegmentedControl';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: Snapshot;
}

export function SettingsDialog({ open, onOpenChange, snapshot }: SettingsDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/20 dark:bg-black/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-3">
              <Dialog.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  className="pointer-events-auto flex max-h-[min(780px,calc(100dvh-24px))] w-full max-w-[640px] rounded-[28px] outline-none"
                  initial={{ scale: 0.96, y: 8 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.97, y: 6, transition: { duration: 0.15 } }}
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
                >
                  <SettingsBody snapshot={snapshot} />
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function SettingsBody({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useI18n();
  const run = useRepository();
  const paneRef = useRef<HTMLDivElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: 28, bevel: 18 });
  const usedAccounts = useMemo(
    () => new Set(snapshot.applications.map((a) => a.accountId)),
    [snapshot.applications],
  );

  const addAccount = () => {
    const color = ACCOUNT_COLORS[snapshot.accounts.length % ACCOUNT_COLORS.length] ?? 'gray';
    const label = String.fromCharCode(65 + (snapshot.accounts.length % 26));
    void run((repo) => repo.saveAccount({ label, email: '', color }));
  };

  return (
    <div
      ref={paneRef}
      style={glass.style}
      className="glass glass-strong flex min-h-0 w-full flex-col overflow-hidden rounded-[inherit]"
    >
      {glass.filter}
      <header className="flex items-center justify-between px-6 pt-5 pb-3">
        <Dialog.Title className="text-[22px] font-semibold tracking-[-0.02em]">
          {t('settings.title')}
        </Dialog.Title>
        <Dialog.Close asChild>
          <IconButton label={t('detail.close')} className="-mr-2">
            <X className="size-[18px]" />
          </IconButton>
        </Dialog.Close>
      </header>

      <div className="scroll-area min-h-0 flex-1 space-y-7 px-6 pt-2 pb-6">
        <Group title={t('settings.accounts')} hint={t('settings.accountsHint')}>
          {snapshot.accounts.map((account) => (
            <AccountRow key={account.id} account={account} inUse={usedAccounts.has(account.id)} />
          ))}
          <AddButton onClick={addAccount}>{t('settings.addAccount')}</AddButton>
        </Group>

        <Group title={t('settings.resumes')}>
          {snapshot.resumes.map((resume) => (
            <Row key={resume.id}>
              <TextInput
                value={resume.name}
                label={t('settings.resumes')}
                onCommit={(name) => void run((repo) => repo.saveResume({ id: resume.id, name }))}
              />
              <IconButton
                label={t('settings.delete')}
                onClick={() => void run((repo) => repo.deleteResume(resume.id))}
                className="size-8 text-fg-3 hover:text-danger"
              >
                <Trash2 className="size-4" />
              </IconButton>
            </Row>
          ))}
          <AddButton onClick={() => void run((repo) => repo.saveResume({ name: t('settings.newResume') }))}>
            {t('settings.addResume')}
          </AddButton>
        </Group>

        <Group title={t('settings.channels')}>
          {snapshot.channels.map((channel) => (
            <Row key={channel.id}>
              {channel.builtin ? (
                <>
                  <span className="flex-1 px-2.5 text-[14px]">{channelName(channel, t)}</span>
                  <span className="pr-2 text-[12px] text-fg-3">{t('settings.builtin')}</span>
                </>
              ) : (
                <>
                  <TextInput
                    value={channel.name}
                    label={t('settings.channels')}
                    onCommit={(name) => void run((repo) => repo.saveChannel({ id: channel.id, name }))}
                  />
                  <IconButton
                    label={t('settings.delete')}
                    onClick={() => void run((repo) => repo.deleteChannel(channel.id))}
                    className="size-8 text-fg-3 hover:text-danger"
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </>
              )}
            </Row>
          ))}
          <AddButton onClick={() => void run((repo) => repo.saveChannel({ name: t('settings.newChannel') }))}>
            {t('settings.addChannel')}
          </AddButton>
        </Group>

        <Group title={t('settings.general')}>
          <GeneralSettings snapshot={snapshot} />
        </Group>
      </div>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-[13px] font-semibold text-fg-2">{title}</h3>
      {hint && <p className="mt-0.5 text-[12px] text-fg-3">{hint}</p>}
      <div className="mt-2.5 space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex min-h-10 items-center gap-2 rounded-[14px] bg-fill p-1', className)}>
      {children}
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-fg-2 transition-colors hover:bg-fill hover:text-fg"
    >
      <Plus className="size-4" aria-hidden="true" />
      {children}
    </button>
  );
}

/** Commits on blur or Enter. Remounts when the stored value changes, so it never shows stale text. */
function TextInput({
  value,
  label,
  onCommit,
  placeholder,
  type = 'text',
  className,
}: {
  value: string;
  label: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'email';
  className?: string;
}) {
  return (
    <input
      key={value}
      type={type}
      defaultValue={value}
      aria-label={label}
      placeholder={placeholder}
      onBlur={(event) => {
        const next = event.target.value.trim();
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      className={clsx(
        'h-8 min-w-0 flex-1 rounded-[10px] bg-transparent px-2.5 text-[14px] outline-none placeholder:text-fg-3 focus:bg-fill-2',
        className,
      )}
    />
  );
}

function AccountRow({ account, inUse }: { account: Account; inUse: boolean }) {
  const { t } = useI18n();
  const run = useRepository();
  const save = (patch: Partial<Pick<Account, 'label' | 'email' | 'color'>>) =>
    void run((repo) =>
      repo.saveAccount({
        id: account.id,
        label: account.label,
        email: account.email,
        color: account.color,
        ...patch,
      }),
    );

  return (
    <Row>
      <ColorPicker value={account.color} onChange={(color) => save({ color })} />
      <TextInput
        value={account.label}
        label={t('settings.label')}
        onCommit={(label) => label && save({ label })}
        className="max-w-[96px] font-semibold"
      />
      <TextInput
        value={account.email}
        type="email"
        label={t('settings.email')}
        placeholder="you@example.com"
        onCommit={(email) => save({ email })}
      />
      {inUse ? (
        <span className="shrink-0 pr-2.5 text-[12px] text-fg-3">{t('settings.inUse')}</span>
      ) : (
        <IconButton
          label={t('settings.delete')}
          onClick={() => void run((repo) => repo.deleteAccount(account.id))}
          className="size-8 text-fg-3 hover:text-danger"
        >
          <Trash2 className="size-4" />
        </IconButton>
      )}
    </Row>
  );
}

function ColorPicker({ value, onChange }: { value: AccountColor; onChange: (color: AccountColor) => void }) {
  const { t } = useI18n();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t('settings.color')}
          className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-fill-2"
        >
          <span className="size-3.5 rounded-full" style={{ background: `var(--acc-${value})` }} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="glass glass-strong z-[60] flex gap-1 rounded-full p-1.5 outline-none data-[state=open]:animate-[pop-in_140ms_ease-out]"
        >
          {ACCOUNT_COLORS.map((color) => (
            <Popover.Close asChild key={color}>
              <button
                type="button"
                aria-label={color}
                aria-pressed={color === value}
                onClick={() => onChange(color)}
                className="grid size-7 place-items-center rounded-full hover:bg-fill"
              >
                <span
                  className={clsx(
                    'size-4 rounded-full',
                    color === value && 'ring-2 ring-fg ring-offset-2 ring-offset-transparent',
                  )}
                  style={{ background: `var(--acc-${color})` }}
                />
              </button>
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function downloadCsv(snapshot: Snapshot) {
  // The BOM makes Excel read the file as UTF-8, which matters for non-Latin company names.
  const blob = new Blob(['﻿', toCsv(snapshot)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `outbox-${toIsoDate(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function GeneralSettings({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useI18n();
  const run = useRepository();
  const locale = usePrefs((p) => p.locale);
  const theme = usePrefs((p) => p.theme);
  const hideRejected = usePrefs((p) => p.hideRejected);

  return (
    <div className="space-y-1.5">
      <Row className="justify-between pl-3">
        <span className="text-[14px]">{t('settings.language')}</span>
        <SegmentedControl<Locale>
          size="sm"
          label={t('settings.language')}
          layoutId="settings-locale"
          segments={[
            { value: 'en', label: 'English' },
            { value: 'zh', label: '中文' },
          ]}
          value={locale}
          onChange={(value) => updatePrefs({ locale: value })}
        />
      </Row>
      <Row className="justify-between pl-3">
        <span className="text-[14px]">{t('settings.theme')}</span>
        <SegmentedControl<ThemePref>
          size="sm"
          label={t('settings.theme')}
          layoutId="settings-theme"
          segments={[
            { value: 'system', label: t('theme.system') },
            { value: 'light', label: t('theme.light') },
            { value: 'dark', label: t('theme.dark') },
          ]}
          value={theme}
          onChange={(value) => updatePrefs({ theme: value })}
        />
      </Row>
      <Row className="justify-between py-2 pr-2 pl-3">
        <span className="text-[14px]">{t('settings.hideRejected')}</span>
        <Switch
          checked={hideRejected}
          onCheckedChange={(value) => updatePrefs({ hideRejected: value })}
          label={t('settings.hideRejected')}
        />
      </Row>
      <Row className="justify-between gap-4 py-2 pr-2 pl-3">
        <span className="min-w-0">
          <span className="block text-[14px]">{t('settings.export')}</span>
          <span className="block text-[12px] text-fg-3">{t('settings.exportHint')}</span>
        </span>
        <Button onClick={() => downloadCsv(snapshot)}>
          <Download className="size-3.5" aria-hidden="true" />
          CSV
        </Button>
      </Row>
      <Row className="justify-between gap-4 py-2 pr-2 pl-3">
        <span className="min-w-0">
          <span className="block text-[14px]">{t('settings.reset')}</span>
          <span className="block text-[12px] text-fg-3">{t('settings.resetHint')}</span>
        </span>
        <Button onClick={() => void run((repo) => repo.resetSampleData())}>
          <RotateCcw className="size-3.5" aria-hidden="true" />
          {t('tweaks.reset')}
        </Button>
      </Row>
    </div>
  );
}
