import clsx from 'clsx';
import { Plus, Search, Settings2, X } from 'lucide-react';
import { useRef } from 'react';
import { FILTERS, type Filter } from '../domain/rows';
import { useHotkey } from '../hooks/useHotkey';
import { useI18n } from '../i18n/context';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { Brand, IconButton } from './primitives';
import { SegmentedControl } from './SegmentedControl';

interface FilterControlProps {
  filter: Filter;
  onFilter: (filter: Filter) => void;
  layoutId: string;
  size?: 'sm' | 'md';
}

/** The status views as a segmented control, for phones, where there is no sidebar. */
export function FilterControl({ filter, onFilter, layoutId, size }: FilterControlProps) {
  const { t } = useI18n();
  const segments = FILTERS.map((value) => ({
    value,
    label: value === 'all' ? t('filter.all') : t(`status.${value}`),
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

interface SearchFieldProps {
  query: string;
  onQuery: (query: string) => void;
  className?: string;
}

/** Search across companies, titles, notes and accounts. `/` focuses it. */
export function SearchField({ query, onQuery, className }: SearchFieldProps) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  useHotkey('/', () => input.current?.focus());

  return (
    <label
      className={clsx(
        'flex h-9 min-w-0 items-center gap-2 rounded-full bg-fill px-3 text-fg-2 transition-colors focus-within:bg-fill-2 focus-within:text-fg',
        className,
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <input
        ref={input}
        type="search"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
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
        <kbd className="kbd max-sm:hidden">/</kbd>
      )}
    </label>
  );
}

interface MobileBarProps {
  query: string;
  onQuery: (query: string) => void;
  onCompose: () => void;
  onOpenSettings: () => void;
}

/** The phone's glass top bar. Adding opens a sheet, since there is no room for the inline composer. */
export function MobileBar({ query, onQuery, onCompose, onOpenSettings }: MobileBarProps) {
  const { t } = useI18n();
  const paneRef = useRef<HTMLDivElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: 22, bevel: 14 });

  return (
    <header className="fixed inset-x-0 top-0 z-30 px-3 pt-[max(12px,env(safe-area-inset-top))]">
      <div
        ref={paneRef}
        style={glass.style}
        className="glass flex h-14 items-center gap-1.5 rounded-[22px] pr-2 pl-3"
      >
        {glass.filter}
        <Brand />
        <SearchField query={query} onQuery={onQuery} className="ml-1 flex-1" />
        <IconButton label={t('toolbar.settings')} onClick={onOpenSettings}>
          <Settings2 className="size-[18px]" />
        </IconButton>
        <button
          type="button"
          aria-label={t('composer.label')}
          title={t('composer.label')}
          onClick={onCompose}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-on-accent transition active:scale-95"
        >
          <Plus className="size-[18px]" />
        </button>
      </div>
    </header>
  );
}
