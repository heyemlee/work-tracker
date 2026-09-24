import clsx from 'clsx';
import { Bookmark, CodeXml, Inbox, Plus, Send, Settings2, Trophy, type LucideIcon } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { FILTERS, type Filter } from '../domain/rows';
import type { Account, Id } from '../domain/types';
import { useI18n } from '../i18n/context';
import { formatCount } from '../i18n/format';
import { updatePrefs, usePrefs } from '../state/prefs';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { Brand, IconButton, Switch } from './primitives';

const VIEW_ICONS: Record<Filter, LucideIcon> = {
  all: Inbox,
  saved: Bookmark,
  applied: Send,
  oa: CodeXml,
  offer: Trophy,
};

interface SidebarProps {
  filter: Filter;
  onFilter: (filter: Filter) => void;
  counts: Record<Filter, number>;
  accounts: Account[];
  accountCounts: Map<Id, number>;
  accountId: Id | null;
  onAccount: (id: Id | null) => void;
  onOpenSettings: () => void;
  /** Shown above the settings row, e.g. the demo notice. */
  footer?: ReactNode;
}

/** The glass sidebar: status views, the accounts to narrow them to, and settings. */
export function Sidebar({
  filter,
  onFilter,
  counts,
  accounts,
  accountCounts,
  accountId,
  onAccount,
  onOpenSettings,
  footer,
}: SidebarProps) {
  const { t, locale } = useI18n();
  const paneRef = useRef<HTMLElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: 26, bevel: 16 });
  const hideRejected = usePrefs((p) => p.hideRejected);

  return (
    <nav
      ref={paneRef}
      style={glass.style}
      aria-label={t('sidebar.label')}
      className="glass flex w-[256px] shrink-0 flex-col rounded-[26px] p-3"
    >
      {glass.filter}
      <div className="px-2 pt-1 pb-5">
        <Brand />
      </div>

      <ul className="space-y-0.5">
        {FILTERS.map((value) => {
          const Icon = VIEW_ICONS[value];
          return (
            <li key={value}>
              <NavItem
                current={filter === value}
                onClick={() => onFilter(value)}
                icon={<Icon className="size-4" aria-hidden="true" />}
                count={formatCount(counts[value], locale)}
              >
                {value === 'all' ? t('filter.all') : t(`status.${value}`)}
              </NavItem>
            </li>
          );
        })}
      </ul>
      <label className="mt-1 flex h-9 items-center justify-between gap-2 px-2.5 text-[13px] text-fg-2">
        {t('list.hideRejected')}
        <Switch checked={hideRejected} onCheckedChange={(value) => updatePrefs({ hideRejected: value })} />
      </label>

      <h2 className="mt-5 px-2.5 pb-1.5 text-[12px] font-semibold text-fg-3">{t('settings.accounts')}</h2>
      <ul className="scroll-area min-h-0 space-y-0.5">
        {accounts.map((account) => {
          const on = accountId === account.id;
          return (
            <li key={account.id}>
              <NavItem
                pressed={on}
                onClick={() => onAccount(on ? null : account.id)}
                title={account.email || account.label}
                icon={<span className="dot" style={{ background: `var(--acc-${account.color})` }} />}
                count={formatCount(accountCounts.get(account.id) ?? 0, locale)}
              >
                {account.email || account.label}
              </NavItem>
            </li>
          );
        })}
        {accounts.length === 0 && (
          <li>
            <NavItem onClick={onOpenSettings} icon={<Plus className="size-4" aria-hidden="true" />}>
              {t('onboarding.action')}
            </NavItem>
          </li>
        )}
      </ul>

      <div className="min-h-4 flex-1" />
      {footer}
      <div className="mt-3 flex items-center gap-1 border-t border-hairline pt-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2.5 text-[14px] text-fg-2 transition-colors hover:bg-fill hover:text-fg"
        >
          <Settings2 className="size-4 shrink-0" aria-hidden="true" />
          {t('toolbar.settings')}
        </button>
        <IconButton
          label={locale === 'en' ? '切换到中文' : 'Switch to English'}
          onClick={() => updatePrefs({ locale: locale === 'en' ? 'zh' : 'en' })}
        >
          <span className="text-[13px] font-semibold">{locale === 'en' ? '中' : 'EN'}</span>
        </IconButton>
      </div>
    </nav>
  );
}

interface NavItemProps {
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
  count?: string;
  /** The view being shown. */
  current?: boolean;
  /** A toggle that is on, like an account narrowing the list. */
  pressed?: boolean;
  title?: string;
}

function NavItem({ onClick, icon, children, count, current, pressed, title }: NavItemProps) {
  const active = current || pressed;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={current ? 'page' : undefined}
      aria-pressed={pressed}
      className={clsx(
        'flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[14px] transition-colors',
        active ? 'bg-fill-2 font-medium text-fg' : 'text-fg-2 hover:bg-fill hover:text-fg',
      )}
    >
      <span className="grid size-4 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="text-[12px] font-normal text-fg-3 tabular-nums">{count}</span>}
    </button>
  );
}
