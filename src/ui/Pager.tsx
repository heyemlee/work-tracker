import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n/context';

interface PagerProps {
  /** Zero-based. */
  page: number;
  pages: number;
  onPage: (page: number) => void;
  size?: 'sm' | 'md';
  className?: string;
}

/** The list's pages: a capsule like the filter's, with a step either way and where this page is among them. */
export function Pager({ page, pages, onPage, size = 'md', className }: PagerProps) {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t('pager.label')}
      className={clsx('inline-flex items-center rounded-full bg-fill p-[3px]', className)}
    >
      <Step label={t('pager.prev')} size={size} disabled={page <= 0} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Step>
      <span
        className={clsx(
          'min-w-11 px-1 text-center font-medium whitespace-nowrap text-fg-3 tabular-nums',
          size === 'sm' ? 'text-[12px]' : 'text-[13px]',
        )}
      >
        <span className="sr-only">{t('pager.status', { page: page + 1, pages })}</span>
        <span aria-hidden="true">
          <span className="text-fg">{page + 1}</span> / {pages}
        </span>
      </span>
      <Step label={t('pager.next')} size={size} disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        <ChevronRight className="size-4" aria-hidden="true" />
      </Step>
    </nav>
  );
}

function Step({
  label,
  size,
  disabled,
  onClick,
  children,
}: {
  label: string;
  size: 'sm' | 'md';
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'grid place-items-center rounded-full text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg active:bg-fill-2 disabled:pointer-events-none disabled:opacity-30',
        size === 'sm' ? 'size-7' : 'size-8',
      )}
    >
      {children}
    </button>
  );
}
