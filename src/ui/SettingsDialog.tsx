import clsx from 'clsx';
import { LogOut, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog, Popover } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { signOut } from '../data/auth';
import { askSettingsFrame, checkExtension, openExtensionOptions, useExtension } from '../data/extension';
import { localRepository, useCurrentUser, useRepository } from '../data/store';
import {
  FROM_EXTENSION,
  type ExtensionSection,
  type FromSettingsFrame,
  type ToSettingsFrame,
} from '../domain/bridge';
import { ACCOUNT_COLORS, type Account, type AccountColor, type Snapshot } from '../domain/types';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { channelName, useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/messages';
import { updatePrefs, usePrefs, type Locale, type ThemePref } from '../state/prefs';
import { navigate, PAGE_PATHS } from '../state/router';
import {
  closeSettings,
  openSettings,
  OUTBOX_PAGES,
  sectionOf,
  useSettingsPage,
  type SettingsPage,
} from '../state/settingsWindow';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { Button, IconButton, Switch } from './primitives';
import { SegmentedControl } from './SegmentedControl';

const OUTBOX_LABELS: Record<(typeof OUTBOX_PAGES)[number], MessageKey> = {
  accounts: 'settings.accounts',
  channels: 'settings.channels',
  general: 'settings.general',
};

/** The extension's sections, under the names they have here: "General" is Outbox's, so the extension's is "Other". */
const EXTENSION_PAGES: { section: ExtensionSection; label: MessageKey }[] = [
  { section: 'connection', label: 'settings.ext.connection' },
  { section: 'ai', label: 'settings.ext.ai' },
  { section: 'reports', label: 'settings.ext.reports' },
  { section: 'memory', label: 'settings.ext.memory' },
  { section: 'general', label: 'settings.ext.other' },
];

/** How the window reaches the extension's page in its frame. */
type FrameHandle = { post: (message: ToSettingsFrame) => void };

/** How long the extension's page has to keep a field still being typed in, once told the window is closing. */
const LEAVING = 120;

/**
 * Outbox's settings and the extension's, in one window: Outbox's pages and then the extension's down the left, the
 * open one to their right. The extension's are its own settings page in a frame (the API key stays in the
 * extension, out of this page's reach). Phones have no extension: they get Outbox's settings alone, one under
 * another. Opened from anywhere with `openSettings`, at the page asked for.
 */
export function SettingsDialog({ snapshot }: { snapshot: Snapshot }) {
  const page = useSettingsPage();
  const desktop = useMediaQuery('(min-width: 768px)');
  const frameRef = useRef<FrameHandle | null>(null);
  // The extension's frame goes in only once the window is at rest: Chrome drops presses on a frame from another
  // origin while it moves and for half a second after.
  const [settled, setSettled] = useState(false);

  const finish = () => {
    closeSettings();
    // A key added or AI turned on in there shows in the menu at once.
    checkExtension();
  };
  // Told first, the extension's page has a moment to keep a field still being typed in: it keeps one as it's left.
  const close = () => {
    if (!frameRef.current) return finish();
    frameRef.current.post({ type: 'settings:closing' });
    window.setTimeout(finish, LEAVING);
  };

  return (
    <Dialog.Root
      open={page !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <AnimatePresence onExitComplete={() => setSettled(false)}>
        {page !== null && (
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
                  className={clsx(
                    'pointer-events-auto flex w-full rounded-[28px] outline-none',
                    desktop
                      ? 'h-[min(660px,calc(100dvh-24px))] max-w-[880px]'
                      : 'max-h-[min(780px,calc(100dvh-24px))] max-w-[640px]',
                  )}
                  initial={{ scale: 0.96, y: 8 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.97, y: 6, transition: { duration: 0.15 } }}
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
                  onAnimationComplete={(target) => {
                    if ((target as { scale?: number }).scale === 1) setSettled(true);
                  }}
                >
                  <SettingsBody
                    page={page}
                    desktop={desktop}
                    snapshot={snapshot}
                    settled={settled}
                    frameRef={frameRef}
                    onFrameClose={finish}
                  />
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

interface BodyProps {
  page: SettingsPage;
  desktop: boolean;
  snapshot: Snapshot;
  settled: boolean;
  frameRef: RefObject<FrameHandle | null>;
  /** The extension's page asked to close (Escape there): it has kept what was typed already. */
  onFrameClose: () => void;
}

function SettingsBody({ desktop, snapshot, ...paged }: BodyProps) {
  const { t } = useI18n();
  const paneRef = useRef<HTMLDivElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: 28, bevel: 18 });

  return (
    <div className="relative flex min-h-0 w-full flex-col overflow-hidden rounded-[inherit]">
      {/* The glass is a layer of its own under the window's content: Chrome draws a frame of another origin inside
          an element with a backdrop filter under that filter, blurred with everything else in the element. */}
      <div
        ref={paneRef}
        style={glass.style}
        aria-hidden="true"
        className="glass glass-strong pointer-events-none absolute inset-0 rounded-[inherit]"
      >
        {glass.filter}
      </div>
      <header className="relative flex items-center justify-between px-6 pt-5 pb-3">
        <Dialog.Title className="text-[22px] font-semibold tracking-[-0.02em]">
          {t('settings.title')}
        </Dialog.Title>
        <Dialog.Close asChild>
          <IconButton label={t('detail.close')} className="-mr-2">
            <X className="size-[18px]" />
          </IconButton>
        </Dialog.Close>
      </header>

      {desktop ? (
        <Paged snapshot={snapshot} {...paged} />
      ) : (
        <div className="scroll-area relative min-h-0 flex-1 space-y-7 px-6 pt-2 pb-6">
          <Group title={t('settings.accounts')} hint={t('settings.accountsHint')}>
            <Accounts snapshot={snapshot} />
          </Group>
          <Group title={t('settings.channels')}>
            <Channels snapshot={snapshot} />
          </Group>
          <Group title={t('settings.general')}>
            <GeneralSettings />
          </Group>
        </div>
      )}
    </div>
  );
}

function Paged({ page, snapshot, settled, frameRef, onFrameClose }: Omit<BodyProps, 'desktop'>) {
  const { t } = useI18n();
  const extension = useExtension();
  const missing = extension.state === 'missing';
  const needsKey = extension.state === 'no-key' || extension.state === 'ai-off';
  // Where the extension isn't running there's nothing of it to show but how to install it; once it runs, its
  // settings take that page's place.
  const shown: SettingsPage = missing
    ? sectionOf(page)
      ? 'extension.install'
      : page
    : page === 'extension.install'
      ? needsKey
        ? 'extension.ai'
        : 'extension.connection'
      : page;
  const section = sectionOf(shown);
  // The frame is put in at the first of the extension's pages looked at, and stays while the window is open: back
  // there, the extension's settings are as they were left.
  const [framed, setFramed] = useState(false);
  if (section && settled && !framed) setFramed(true);

  return (
    <div className="relative grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label={t('settings.title')} className="scroll-area flex flex-col gap-3 px-3 pt-1 pb-6">
        <NavGroup label="Outbox">
          {OUTBOX_PAGES.map((name) => (
            <NavItem key={name} page={name} current={shown}>
              {t(OUTBOX_LABELS[name])}
            </NavItem>
          ))}
        </NavGroup>
        <NavGroup
          label={t('settings.extension')}
          title={extension.version ? t('ext.version', { version: extension.version }) : undefined}
        >
          {missing ? (
            <NavItem page="extension.install" current={shown}>
              {t('guide.ext.install')}
            </NavItem>
          ) : (
            EXTENSION_PAGES.map(({ section: name, label }) => (
              <NavItem
                key={name}
                page={`extension.${name}`}
                current={shown}
                note={name === 'ai' && needsKey ? t(`ext.${extension.state}` as MessageKey) : undefined}
              >
                {t(label)}
              </NavItem>
            ))
          )}
        </NavGroup>
      </nav>
      <div className="relative min-h-0">
        {framed && !missing && (
          <ExtensionFrame
            section={section ?? 'connection'}
            shown={section !== null}
            frameRef={frameRef}
            onClose={onFrameClose}
          />
        )}
        {section === null && (
          <div className="scroll-area absolute inset-0 px-6 pt-1 pb-6">
            {shown === 'accounts' && (
              <>
                <p className="mb-2.5 text-[12px] text-fg-3">{t('settings.accountsHint')}</p>
                <div className="space-y-1.5">
                  <Accounts snapshot={snapshot} />
                </div>
              </>
            )}
            {shown === 'channels' && (
              <div className="space-y-1.5">
                <Channels snapshot={snapshot} />
              </div>
            )}
            {shown === 'general' && <GeneralSettings />}
            {shown === 'extension.install' && <Install />}
          </div>
        )}
      </div>
    </div>
  );
}

function NavGroup({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div>
      <p title={title} className="px-3 pb-1 text-[12px] font-semibold text-fg-3">
        {label}
      </p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

/** A page of the window. `note`: what the extension needs, behind a dot (its words say it to a screen reader). */
function NavItem({
  page,
  current,
  note,
  children,
}: {
  page: SettingsPage;
  current: SettingsPage;
  note?: string;
  children: ReactNode;
}) {
  const active = page === current;
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      title={note}
      onClick={() => openSettings(page)}
      className={clsx(
        'relative flex h-9 w-full shrink-0 items-center gap-2 rounded-[10px] px-3 text-left text-[13px] font-medium transition-colors',
        active ? 'text-fg' : 'text-fg-2 hover:text-fg',
      )}
    >
      {active && (
        <motion.span
          layoutId="settings-page"
          aria-hidden="true"
          className="absolute inset-0 rounded-[10px] bg-fill-2"
          transition={{ type: 'spring', bounce: 0.18, duration: 0.45 }}
        />
      )}
      <span className="relative min-w-0 flex-1 truncate">{children}</span>
      {note && (
        <span className="relative size-1.5 shrink-0 rounded-full bg-[var(--acc-orange)]">
          <span className="sr-only">{note}</span>
        </span>
      )}
    </button>
  );
}

/** Whether the window shows on a dark ground: Outbox's theme, or the system's where it follows that. */
function useDark(): boolean {
  const theme = usePrefs((p) => p.theme);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  return theme === 'dark' || (theme === 'system' && systemDark);
}

/**
 * The extension's settings, drawn by the extension itself: its own page, in a frame of its own origin, where nothing
 * typed (the API key) reaches this page and this page can press nothing. Asked for once, on a ticket good for one
 * showing, and kept while the window is open; the section and the side of light or dark are told to it as they
 * change. Where it doesn't draw (a build of the extension from before this window), it can still be opened in a
 * window of its own.
 */
function ExtensionFrame({
  section,
  shown,
  frameRef,
  onClose,
}: {
  section: ExtensionSection;
  /** One of the extension's pages is open: otherwise the frame waits unseen, laid out where it shows. */
  shown: boolean;
  frameRef: RefObject<FrameHandle | null>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dark = useDark();
  const ref = useRef<HTMLIFrameElement>(null);
  // Undefined while asking; null where nothing answered.
  const [url, setUrl] = useState<string | null>();
  const [drawn, setDrawn] = useState(false);
  const [stuck, setStuck] = useState(false);
  const origin = useMemo(() => (url ? new URL(url).origin : null), [url]);
  // Asked once, for what's open as it's asked; what changes after is told to the page.
  const first = useRef({ section, dark });
  const closing = useRef(onClose);
  useEffect(() => {
    closing.current = onClose;
  });

  useEffect(() => {
    let current = true;
    void askSettingsFrame(first.current.section, first.current.dark).then((answer) => {
      if (current) setUrl(answer);
    });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!origin) return undefined;
    frameRef.current = { post: (message) => ref.current?.contentWindow?.postMessage(message, origin) };
    // What the page says: that it drew, and to close (Escape there).
    const onMessage = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow || event.origin !== origin) return;
      const message = event.data as FromSettingsFrame | null;
      if (message?.source !== FROM_EXTENSION) return;
      if (message.type === 'settings-shown') setDrawn(true);
      if (message.type === 'settings-close') closing.current();
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      frameRef.current = null;
    };
  }, [origin, frameRef]);

  // A page that doesn't draw within a few seconds won't: say so, and offer the extension's own window.
  useEffect(() => {
    if (!url || drawn) return undefined;
    const timer = window.setTimeout(() => setStuck(true), 6000);
    return () => window.clearTimeout(timer);
  }, [url, drawn]);

  useEffect(() => {
    if (drawn) frameRef.current?.post({ type: 'settings:section', section });
  }, [drawn, section, frameRef]);
  useEffect(() => {
    if (drawn) frameRef.current?.post({ type: 'settings:scheme', dark });
  }, [drawn, dark, frameRef]);

  if (url === null || stuck)
    return shown ? (
      <div className="absolute inset-0 px-6 pt-1">
        <p className="max-w-[460px] text-[13px] leading-relaxed text-fg-2">{t('settings.ext.stale')}</p>
        <Button
          className="mt-3"
          onClick={() => {
            closeSettings();
            openExtensionOptions();
          }}
        >
          {t('ext.openOptions')}
        </Button>
      </div>
    ) : null;
  if (!url) return null;
  return (
    <iframe
      ref={ref}
      src={url}
      title={t('settings.extension')}
      aria-hidden={shown ? undefined : true}
      tabIndex={shown ? undefined : -1}
      // Clear on the window's glass only where the page in it is on the same side of light and dark.
      style={{ colorScheme: dark ? 'dark' : 'light' }}
      className={clsx('absolute inset-0 size-full border-0', !(shown && drawn) && 'invisible')}
    />
  );
}

/** Where the extension isn't running: what it would show here, and the way to the guide's step for installing it. */
function Install() {
  const { t } = useI18n();
  return (
    <div className="max-w-[460px]">
      <p className="text-[14px]">{t('ext.missing')}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-fg-3">{t('settings.ext.installHint')}</p>
      <Button
        variant="primary"
        className="mt-4"
        onClick={() => {
          closeSettings();
          navigate(`${PAGE_PATHS.welcome}?step=3`);
        }}
      >
        {t('guide.ext.install')}
      </Button>
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

function Accounts({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useI18n();
  const run = useRepository();
  const usedAccounts = useMemo(
    () => new Set(snapshot.applications.map((a) => a.accountId)),
    [snapshot.applications],
  );

  // A new account starts as an email field and is only created once an address is entered.
  const [adding, setAdding] = useState(false);
  const newColor = ACCOUNT_COLORS[snapshot.accounts.length % ACCOUNT_COLORS.length] ?? 'gray';
  const addAccount = (email: string) => {
    // The label is no longer shown; it stays as a short internal name.
    const label = String.fromCharCode(65 + (snapshot.accounts.length % 26));
    void run((repo) => repo.saveAccount({ label, email, color: newColor }));
  };

  return (
    <>
      {snapshot.accounts.map((account) => (
        <AccountRow key={account.id} account={account} inUse={usedAccounts.has(account.id)} />
      ))}
      {adding ? (
        <NewAccountRow color={newColor} onSave={addAccount} onDone={() => setAdding(false)} />
      ) : (
        <AddButton onClick={() => setAdding(true)}>{t('settings.addAccount')}</AddButton>
      )}
    </>
  );
}

function Channels({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useI18n();
  const run = useRepository();
  return (
    <>
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
    </>
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

/** An email field for a new account. Enter or leaving the field saves it; leaving it empty cancels. */
function NewAccountRow({
  color,
  onSave,
  onDone,
}: {
  color: Account['color'];
  onSave: (email: string) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [invalid, setInvalid] = useState(false);
  const finished = useRef(false);

  const commit = (input: HTMLInputElement) => {
    if (finished.current) return;
    const email = input.value.trim();
    if (email && !input.checkValidity()) {
      setInvalid(true);
      return;
    }
    finished.current = true;
    if (email) onSave(email);
    onDone();
  };

  return (
    <div>
      <Row>
        <span className="grid size-8 shrink-0 place-items-center">
          <span className="size-3.5 rounded-full" style={{ background: `var(--acc-${color})` }} />
        </span>
        <input
          type="email"
          autoFocus
          aria-label={t('settings.email')}
          placeholder="you@example.com"
          onChange={() => setInvalid(false)}
          onBlur={(event) => commit(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(event.currentTarget);
          }}
          className="h-8 min-w-0 flex-1 rounded-[10px] bg-fill-2 px-2.5 text-[14px] outline-none placeholder:text-fg-3"
        />
      </Row>
      {invalid && <p className="mt-1 px-3 text-[12px] text-danger">{t('settings.invalidEmail')}</p>}
    </div>
  );
}

function AccountRow({ account, inUse }: { account: Account; inUse: boolean }) {
  const { t } = useI18n();
  const run = useRepository();
  const save = (patch: Partial<Pick<Account, 'email' | 'color'>>) =>
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
        value={account.email}
        type="email"
        label={t('settings.email')}
        placeholder="you@example.com"
        onCommit={(email) => save({ email })}
      />
      {/* An account with applications can't be deleted: its applications would lose who sent them. */}
      {!inUse && (
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

function GeneralSettings() {
  const { t } = useI18n();
  const run = useRepository();
  const locale = usePrefs((p) => p.locale);
  const theme = usePrefs((p) => p.theme);
  const hideRejected = usePrefs((p) => p.hideRejected);
  const goal = usePrefs((p) => p.dailyGoal);
  const { data: user } = useCurrentUser();
  // Sample data can be restored in the local prototype; the owner's app has real data.
  const resetSample = localRepository ? () => run(async () => localRepository?.resetSampleData()) : null;

  return (
    <div className="space-y-1.5">
      <Row className="justify-between gap-4 py-2 pr-2 pl-3">
        <span className="min-w-0">
          <span className="block text-[14px]">{t('settings.language')}</span>
          <span className="block text-[12px] text-fg-3">{t('settings.languageHint')}</span>
        </span>
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
      {/* Four segments are wider than a phone leaves beside the label: the control drops to a line of its own. */}
      <Row className="flex-wrap justify-between gap-y-0 pl-3">
        <span className="py-1.5 text-[14px]">{t('settings.theme')}</span>
        <SegmentedControl<ThemePref>
          size="sm"
          className="ml-auto"
          label={t('settings.theme')}
          layoutId="settings-theme"
          segments={[
            { value: 'system', label: t('theme.system') },
            { value: 'light', label: t('theme.light') },
            { value: 'white', label: t('theme.white') },
            { value: 'dark', label: t('theme.dark') },
          ]}
          value={theme}
          onChange={(value) => updatePrefs({ theme: value })}
        />
      </Row>
      <Row className="justify-between gap-4 py-2 pr-2 pl-3">
        <label htmlFor="settings-goal" className="min-w-0">
          <span className="block text-[14px]">{t('settings.goal')}</span>
          <span className="block text-[12px] text-fg-3">{t('settings.goalHint')}</span>
        </label>
        <input
          id="settings-goal"
          type="number"
          min={1}
          max={500}
          defaultValue={goal ?? ''}
          onChange={(event) => {
            const value = Number.parseInt(event.target.value, 10);
            updatePrefs({ dailyGoal: Number.isFinite(value) && value > 0 ? value : null });
          }}
          className="h-8 w-20 shrink-0 rounded-[10px] bg-fill-2 px-2.5 text-right text-[14px] outline-none"
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
      {resetSample ? (
        <Row className="justify-between gap-4 py-2 pr-2 pl-3">
          <span className="min-w-0">
            <span className="block text-[14px]">{t('settings.reset')}</span>
            <span className="block text-[12px] text-fg-3">{t('settings.resetHint')}</span>
          </span>
          <Button onClick={() => void resetSample()}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {t('tweaks.reset')}
          </Button>
        </Row>
      ) : (
        user && (
          <Row className="justify-between gap-4 py-2 pr-2 pl-3">
            <span className="min-w-0">
              <span className="block text-[12px] text-fg-3">{t('settings.signedInAs')}</span>
              <span className="block truncate text-[14px]">{user.email}</span>
            </span>
            <Button onClick={() => void signOut()}>
              <LogOut className="size-3.5" aria-hidden="true" />
              {t('settings.signOut')}
            </Button>
          </Row>
        )
      )}
    </div>
  );
}
