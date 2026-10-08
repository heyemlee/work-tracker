import clsx from 'clsx';
import {
  Download,
  LogOut,
  Map as MapIcon,
  Plus,
  Puzzle,
  Search,
  Settings2,
  UserRound,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Popover } from 'radix-ui';
import { useRef, useState, type ReactNode } from 'react';
import { signOut } from '../data/auth';
import { downloadCsv } from '../data/export';
import { openExtensionOptions, useExtension, type ExtensionInfo } from '../data/extension';
import { localRepository, useCurrentUser } from '../data/store';
import { FILTERS, type Filter } from '../domain/rows';
import type { Snapshot } from '../domain/types';
import { useHotkey } from '../hooks/useHotkey';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/messages';
import { updatePrefs, usePrefs, type Locale } from '../state/prefs';
import { navigate, PAGE_PATHS, type Page } from '../state/router';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { Link } from './Link';
import { PAGES, useProfileBlanks } from './pages';
import { Brand, Button } from './primitives';
import { SegmentedControl } from './SegmentedControl';

interface FilterControlProps {
  filter: Filter;
  onFilter: (filter: Filter) => void;
  counts: Record<Filter, number>;
  layoutId: string;
  size?: 'sm' | 'md';
}

/** The status filter above the list, with how many jobs each status holds. */
export function FilterControl({ filter, onFilter, counts, layoutId, size }: FilterControlProps) {
  const { t } = useI18n();
  const segments = FILTERS.map((value) => ({
    value,
    label: value === 'all' ? t('filter.all') : t(`status.${value}`),
    count: counts[value],
  }));
  return (
    <SegmentedControl
      segments={segments}
      value={filter}
      onChange={onFilter}
      label={t('toolbar.filter')}
      layoutId={layoutId}
      size={size}
    />
  );
}

interface ToolbarProps {
  page: Page;
  query: string;
  onQuery: (query: string) => void;
  onCompose: () => void;
  onOpenSettings: () => void;
  snapshot: Snapshot;
}

export function Toolbar({ page, query, onQuery, onCompose, onOpenSettings, snapshot }: ToolbarProps) {
  const { t } = useI18n();
  const paneRef = useRef<HTMLDivElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: 22, bevel: 14 });
  const searchInput = useRef<HTMLInputElement>(null);
  const blanks = useProfileBlanks();
  useHotkey('/', () => searchInput.current?.focus());

  // Search is about the applications: typing elsewhere goes back to them.
  const search = (value: string) => {
    onQuery(value);
    if (page !== 'applications' && value) navigate(PAGE_PATHS.applications);
  };

  return (
    <header className="fixed inset-x-0 top-0 z-30 px-3 pt-3 sm:px-5">
      <div
        ref={paneRef}
        style={glass.style}
        className="glass mx-auto flex h-14 max-w-[1040px] items-center gap-2 rounded-[22px] pr-2 pl-3"
      >
        {glass.filter}
        <Link to={PAGE_PATHS.applications} aria-label="Outbox" className="rounded-full">
          <Brand />
        </Link>
        <nav aria-label={t('nav.label')} className="hidden flex-1 justify-center md:flex">
          <div className="inline-flex rounded-full bg-fill p-[3px]">
            {PAGES.map((item) => {
              const active = item.page === page;
              return (
                <Link
                  key={item.page}
                  to={PAGE_PATHS[item.page]}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'relative flex h-8 min-w-20 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-medium whitespace-nowrap transition-colors',
                    active ? 'text-fg' : 'text-fg-2 hover:text-fg',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="page-thumb"
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full"
                      style={{ background: 'var(--thumb)', boxShadow: 'var(--thumb-shadow)' }}
                      transition={{ type: 'spring', bounce: 0.18, duration: 0.45 }}
                    />
                  )}
                  <span className="relative">{t(item.label)}</span>
                  {item.page === 'profile' && blanks > 0 && (
                    <span
                      className="relative grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-on-accent"
                      aria-label={t('nav.missing', { n: blanks })}
                    >
                      {blanks}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-1 md:ml-0">
          <label className="flex h-9 min-w-0 items-center gap-2 rounded-full bg-fill px-3 text-fg-2 transition-colors focus-within:bg-fill-2 focus-within:text-fg sm:w-[210px]">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <input
              ref={searchInput}
              type="search"
              value={query}
              onChange={(event) => search(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                onQuery('');
                event.currentTarget.blur();
              }}
              placeholder={t('toolbar.search')}
              aria-label={t('toolbar.search')}
              className="w-full min-w-0 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-3"
            />
            {query ? (
              <button
                type="button"
                aria-label={t('toolbar.clearSearch')}
                onClick={() => onQuery('')}
                className="grid size-5 shrink-0 place-items-center rounded-full bg-fill-2 text-fg-2"
              >
                <X className="size-3" />
              </button>
            ) : (
              <kbd className="kbd hidden sm:inline-grid">/</kbd>
            )}
          </label>
          <ExtensionStatus />
          <button
            type="button"
            onClick={onCompose}
            aria-label={t('composer.label')}
            title={`${t('composer.label')} (N)`}
            className="ml-1 flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent px-2.5 text-[13px] font-semibold text-on-accent transition hover:opacity-90 active:scale-[0.97] max-md:hidden sm:pr-3.5"
          >
            <Plus className="size-[18px]" aria-hidden="true" />
            <span>{t('toolbar.new')}</span>
          </button>
          <AccountMenu snapshot={snapshot} onOpenSettings={onOpenSettings} />
        </div>
      </div>
    </header>
  );
}

const STATUS_COLOR: Record<ExtensionInfo['state'], string | null> = {
  checking: null,
  missing: 'var(--acc-gray)',
  'no-key': 'var(--acc-orange)',
  'ai-off': 'var(--acc-orange)',
  ready: 'var(--acc-green)',
};

/** The extension at a glance: a dot on its icon, and what to do about it on click. Hidden on phones. */
function ExtensionStatus() {
  const { t } = useI18n();
  const extension = useExtension();
  const color = STATUS_COLOR[extension.state];
  const summary = extension.state === 'ready' ? t('ext.ready') : t(`ext.${extension.state}` as MessageKey);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`${t('ext.name')}: ${summary}`}
          title={`${t('ext.name')}: ${summary}`}
          className="relative grid size-9 shrink-0 place-items-center rounded-full text-fg-2 transition-colors hover:bg-fill hover:text-fg max-md:hidden"
        >
          <Puzzle className="size-[18px]" aria-hidden="true" />
          {color && (
            <span
              aria-hidden="true"
              className="absolute top-[7px] right-[7px] size-2 rounded-full ring-2 ring-canvas"
              style={{ background: color }}
            />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="glass glass-strong z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-[18px] p-3.5 outline-none data-[state=open]:animate-[pop-in_160ms_ease-out]"
        >
          <p className="flex items-center gap-2 text-[14px] font-semibold">
            {color && <span className="size-2 rounded-full" style={{ background: color }} />}
            {t('ext.name')}
          </p>
          <p className="mt-1 text-[13px] text-fg-2">
            {summary}
            {extension.version && extension.state === 'ready' && (
              <span className="text-fg-3"> · {t('ext.version', { version: extension.version })}</span>
            )}
          </p>
          {extension.state === 'missing' && (
            <p className="mt-1 text-[12px] text-fg-3">{t('ext.missingHint')}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {extension.state === 'missing' ? (
              <>
                <Popover.Close asChild>
                  <Button onClick={() => navigate(`${PAGE_PATHS.welcome}?step=3`)}>{t('ext.howTo')}</Button>
                </Popover.Close>
                <Button variant="ghost" onClick={() => window.location.reload()}>
                  {t('ext.reload')}
                </Button>
              </>
            ) : (
              extension.state !== 'checking' && (
                <Popover.Close asChild>
                  <Button
                    variant={extension.state === 'ready' ? 'secondary' : 'primary'}
                    onClick={openExtensionOptions}
                  >
                    {t('ext.openOptions')}
                  </Button>
                </Popover.Close>
              )
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Settings, language, export, the setup guide and signing out, behind the owner's avatar. */
function AccountMenu({ snapshot, onOpenSettings }: { snapshot: Snapshot; onOpenSettings: () => void }) {
  const { t } = useI18n();
  const { data: user } = useCurrentUser();
  const locale = usePrefs((p) => p.locale);
  const [open, setOpen] = useState(false);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t('menu.label')}
          title={t('menu.label')}
          className="grid size-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-fill"
        >
          {user?.image ? (
            <img src={user.image} alt="" referrerPolicy="no-referrer" className="size-7 rounded-full" />
          ) : (
            <span className="grid size-7 place-items-center rounded-full bg-fill-2 text-fg-2">
              <UserRound className="size-4" aria-hidden="true" />
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="glass glass-strong z-50 w-64 origin-(--radix-popover-content-transform-origin) rounded-[18px] p-1.5 outline-none data-[state=open]:animate-[pop-in_160ms_ease-out]"
        >
          {user && (
            <>
              <p className="truncate px-2.5 pt-1.5 pb-2 text-[12px] text-fg-3">{user.email}</p>
              <div className="mx-2 mb-1 h-px bg-hairline" />
            </>
          )}
          <MenuItem icon={<Settings2 className="size-4" />} onClick={() => choose(onOpenSettings)}>
            {t('menu.settings')}
          </MenuItem>
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
            <span className="text-[14px]">{t('menu.language')}</span>
            <SegmentedControl<Locale>
              size="sm"
              label={t('menu.language')}
              layoutId="menu-locale"
              segments={[
                { value: 'en', label: 'EN' },
                { value: 'zh', label: '中文' },
              ]}
              value={locale}
              onChange={(value) => updatePrefs({ locale: value })}
            />
          </div>
          <MenuItem
            icon={<Download className="size-4" />}
            onClick={() => choose(() => downloadCsv(snapshot))}
          >
            {t('menu.export')}
          </MenuItem>
          <MenuItem
            icon={<MapIcon className="size-4" />}
            onClick={() => choose(() => navigate(PAGE_PATHS.welcome))}
          >
            {t('menu.guide')}
          </MenuItem>
          {!localRepository && user && (
            <>
              <div className="mx-2 my-1 h-px bg-hairline" />
              <MenuItem icon={<LogOut className="size-4" />} onClick={() => choose(() => void signOut())}>
                {t('menu.signOut')}
              </MenuItem>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MenuItem({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-[14px] transition-colors hover:bg-fill focus-visible:bg-fill focus-visible:outline-none"
    >
      <span className="text-fg-2" aria-hidden="true">
        {icon}
      </span>
      {children}
    </button>
  );
}

/** Phones: the four pages as a glass tab bar at the bottom, with New beside it. */
export function TabBar({ page, onCompose }: { page: Page; onCompose: () => void }) {
  const { t } = useI18n();
  const paneRef = useRef<HTMLElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: 30, bevel: 16 });
  const blanks = useProfileBlanks();

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex items-end gap-3 px-4 pb-[max(16px,env(safe-area-inset-bottom))] md:hidden">
      <nav
        ref={paneRef}
        style={glass.style}
        aria-label={t('nav.label')}
        className="glass flex h-[60px] flex-1 rounded-full p-[5px]"
      >
        {glass.filter}
        {PAGES.map((item) => {
          const active = item.page === page;
          const Icon = item.icon;
          return (
            <Link
              key={item.page}
              to={PAGE_PATHS[item.page]}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-medium transition-colors',
                active ? 'bg-fill-2 text-fg' : 'text-fg-2',
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              {t(item.label)}
              {item.page === 'profile' && blanks > 0 && (
                <span
                  className="absolute top-2 right-[calc(50%-18px)] size-2 rounded-full bg-accent"
                  aria-label={t('nav.missing', { n: blanks })}
                />
              )}
            </Link>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={onCompose}
        aria-label={t('composer.label')}
        className="grid size-[60px] shrink-0 place-items-center rounded-full bg-accent text-on-accent shadow-[0_14px_30px_-12px_rgb(0_0_0/0.5)] transition active:scale-[0.96]"
      >
        <Plus className="size-6" aria-hidden="true" />
      </button>
    </div>
  );
}
