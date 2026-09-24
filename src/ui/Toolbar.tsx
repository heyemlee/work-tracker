import { Search, Settings2, X } from 'lucide-react';
import { useRef } from 'react';
import { FILTERS, type Filter } from '../domain/rows';
import { useHotkey } from '../hooks/useHotkey';
import { useI18n } from '../i18n/context';
import { updatePrefs } from '../state/prefs';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { Brand, IconButton } from './primitives';
import { SegmentedControl } from './SegmentedControl';

interface FilterControlProps {
  filter: Filter;
  onFilter: (filter: Filter) => void;
  layoutId: string;
  size?: 'sm' | 'md';
}

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

interface ToolbarProps {
  filter: Filter;
  onFilter: (filter: Filter) => void;
  query: string;
  onQuery: (query: string) => void;
  onOpenSettings: () => void;
}

export function Toolbar({ filter, onFilter, query, onQuery, onOpenSettings }: ToolbarProps) {
  const { t, locale } = useI18n();
  const paneRef = useRef<HTMLDivElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: 22, bevel: 14 });
  const searchInput = useRef<HTMLInputElement>(null);
  useHotkey('/', () => searchInput.current?.focus());

  return (
    <header className="fixed inset-x-0 top-0 z-30 px-3 pt-3 sm:px-5">
      <div
        ref={paneRef}
        style={glass.style}
        className="glass mx-auto flex h-14 max-w-[1040px] items-center gap-2 rounded-[22px] pr-2 pl-3"
      >
        {glass.filter}
        <Brand />
        <nav className="hidden flex-1 justify-center md:flex">
          <FilterControl filter={filter} onFilter={onFilter} layoutId="filter-toolbar" />
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-1 md:ml-0">
          <label className="flex h-9 min-w-0 items-center gap-2 rounded-full bg-fill px-3 text-fg-2 transition-colors focus-within:bg-fill-2 focus-within:text-fg sm:w-[210px]">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <input
              ref={searchInput}
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
              <kbd className="kbd hidden sm:inline-grid">/</kbd>
            )}
          </label>
          <IconButton
            label={locale === 'en' ? '切换到中文' : 'Switch to English'}
            onClick={() => updatePrefs({ locale: locale === 'en' ? 'zh' : 'en' })}
          >
            <span className="text-[13px] font-semibold">{locale === 'en' ? '中' : 'EN'}</span>
          </IconButton>
          <IconButton label={t('toolbar.settings')} onClick={onOpenSettings}>
            <Settings2 className="size-[18px]" />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
