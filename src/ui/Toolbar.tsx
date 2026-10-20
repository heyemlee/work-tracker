import clsx from 'clsx';
import { Ellipsis, LogOut, Map as MapIcon, Plus, Search, Settings2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { Popover } from 'radix-ui';
import { useRef, useState, type ReactNode } from 'react';
import { signOut } from '../data/auth';
import { useExtension, type ExtensionInfo } from '../data/extension';
import { localRepository, useCurrentUser } from '../data/store';
import { FILTERS, type Filter } from '../domain/rows';
import { useHotkey } from '../hooks/useHotkey';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/messages';
import { navigate, PAGE_PATHS, type Page } from '../state/router';
import { openSettings, type SettingsPage } from '../state/settingsWindow';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { Link } from './Link';
import { navCurrent, PAGES, useProfileBlanks } from './pages';
import { Brand } from './primitives';
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
}

export function Toolbar({ page, query, onQuery, onCompose }: ToolbarProps) {
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
        className="glass mx-auto flex h-14 max-w-[1240px] items-center gap-2 rounded-[22px] pr-2.5 pl-3"
      >
        {glass.filter}
        <Link to={PAGE_PATHS.applications} aria-label="Outbox" className="rounded-full">
          <Brand />
        </Link>
        <nav aria-label={t('nav.label')} className="hidden flex-1 justify-center xl:flex">
          <div className="inline-flex rounded-full bg-fill p-[3px]">
            {PAGES.map((item) => {
              const current = navCurrent(item.page, page);
              const active = current !== undefined;
              return (
                <Link
                  key={item.page}
                  to={PAGE_PATHS[item.page]}
                  aria-current={current}
                  className={clsx(
                    'relative flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
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
        <div className="ml-auto flex min-w-0 items-center gap-2 xl:ml-0">
          <label className="flex h-9 min-w-0 items-center gap-2 rounded-full bg-fill px-3 text-fg-2 transition-colors focus-within:bg-fill-2 focus-within:text-fg sm:w-[210px] xl:w-[150px]">
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
          <button
            type="button"
            onClick={onCompose}
            aria-label={t('composer.label')}
            title={`${t('composer.label')} (N)`}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent px-2.5 text-[13px] font-semibold text-on-accent transition hover:opacity-90 active:scale-[0.97] max-xl:hidden sm:pr-3.5"
          >
            <Plus className="size-[18px]" aria-hidden="true" />
            <span>{t('toolbar.new')}</span>
          </button>
          <MoreMenu />
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

/**
 * Everything that is neither a page nor New, behind one button: settings (Outbox's and the extension's, in one
 * window), the setup guide and signing out. The button carries a dot only while the extension needs
 * something, which Settings then says, and opens where it's dealt with.
 */
function MoreMenu() {
  const { t } = useI18n();
  const { data: user } = useCurrentUser();
  const extension = useExtension();
  // Extensions run in Chrome on a computer: a phone has nothing to say about one.
  const desktop = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState(false);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  const ready = extension.state === 'ready';
  const color = STATUS_COLOR[extension.state];
  const summary = ready ? t('ext.ready') : t(`ext.${extension.state}` as MessageKey);
  const dot = desktop && !ready && color;
  const label = dot ? `${t('menu.label')} · ${summary}` : t('menu.label');
  const settingsAt: SettingsPage = !dot
    ? 'accounts'
    : extension.state === 'missing'
      ? 'extension.install'
      : 'extension.ai';

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="relative grid size-9 shrink-0 place-items-center rounded-full bg-fill text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg data-[state=open]:bg-fill-2 data-[state=open]:text-fg"
        >
          <Ellipsis className="size-[18px]" aria-hidden="true" />
          {dot && (
            <span
              aria-hidden="true"
              className="absolute top-0.5 right-0.5 size-2 rounded-full ring-2 ring-canvas"
              style={{ background: dot }}
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
          className="glass glass-strong z-50 w-[272px] origin-(--radix-popover-content-transform-origin) rounded-[18px] p-1.5 outline-none data-[state=open]:animate-[pop-in_160ms_ease-out]"
        >
          {user && (
            <>
              <p className="truncate px-2.5 pt-1.5 pb-2 text-[12px] text-fg-3">{user.email}</p>
              <div className="mx-2 mb-1 h-px bg-hairline" />
            </>
          )}
          <MenuItem
            icon={<Settings2 className="size-4" />}
            note={dot && <Status color={dot}>{summary}</Status>}
            onClick={() => choose(() => openSettings(settingsAt))}
          >
            {t('menu.settings')}
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

/** The extension's state in a few words, behind its dot. */
function Status({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="flex gap-1.5 text-[12px] leading-4 font-normal text-fg-2">
      <span
        aria-hidden="true"
        className="mt-[5px] size-1.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      {children}
    </span>
  );
}

interface MenuItemProps {
  icon: ReactNode;
  onClick: () => void;
  /** A line of its own under the label. */
  note?: ReactNode;
  children: ReactNode;
}

function MenuItem({ icon, onClick, note, children }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-[14px] leading-5 transition-colors hover:bg-fill focus-visible:bg-fill focus-visible:outline-none"
    >
      <span className="flex h-5 items-center text-fg-2" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{children}</span>
        {note && <span className="mt-0.5 block">{note}</span>}
      </span>
    </button>
  );
}

/** Compact screens: three common destinations and a menu, with New beside them. */
export function TabBar({ page, onCompose }: { page: Page; onCompose: () => void }) {
  const { t } = useI18n();
  const paneRef = useRef<HTMLElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: 30, bevel: 16 });
  const blanks = useProfileBlanks();

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex items-end gap-2 px-3 pb-[max(16px,env(safe-area-inset-bottom))] xl:hidden">
      <nav
        ref={paneRef}
        style={glass.style}
        aria-label={t('nav.label')}
        className="glass flex h-[60px] flex-1 rounded-full p-[5px]"
      >
        {glass.filter}
        {PAGES.filter((item) => COMPACT_PAGES.includes(item.page)).map((item) => {
          const current = navCurrent(item.page, page);
          const active = current !== undefined;
          const Icon = item.icon;
          return (
            <Link
              key={item.page}
              to={PAGE_PATHS[item.page]}
              aria-label={t(item.label)}
              aria-current={current}
              className={clsx(
                'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-medium transition-colors',
                active ? 'bg-fill-2 text-fg' : 'text-fg-2',
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              <span className="whitespace-nowrap">
                {t(item.page === 'applications' ? 'nav.compactApplications' : item.label)}
              </span>
              {item.page === 'profile' && blanks > 0 && (
                <span
                  className="absolute top-2 right-[calc(50%-18px)] size-2 rounded-full bg-accent"
                  aria-label={t('nav.missing', { n: blanks })}
                />
              )}
            </Link>
          );
        })}
        <MorePages page={page} />
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

const COMPACT_PAGES: Page[] = ['applications', 'resumes', 'discovery'];

function MorePages({ page }: { page: Page }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const items = PAGES.filter((item) => !COMPACT_PAGES.includes(item.page));
  const current = items.find((item) => navCurrent(item.page, page));
  const Icon = current?.icon ?? Ellipsis;
  const blanks = useProfileBlanks();
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          aria-label={t('nav.morePages')}
          className={clsx(
            'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-medium',
            current ? 'bg-fill-2 text-fg' : 'text-fg-2',
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
          {current ? t(current.label) : t('nav.compactMore')}
          {blanks > 0 && (
            <span
              className="absolute top-2 right-[calc(50%-18px)] size-2 rounded-full bg-accent"
              aria-label={t('nav.missing', { n: blanks })}
            />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={12}
          collisionPadding={12}
          className="glass glass-strong z-50 w-60 rounded-[18px] p-2 outline-none"
        >
          {items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <Link
                key={item.page}
                to={PAGE_PATHS[item.page]}
                onClick={() => setOpen(false)}
                aria-current={navCurrent(item.page, page)}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-[14px] hover:bg-fill"
              >
                <ItemIcon className="size-4" />
                {t(item.label)}
              </Link>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
