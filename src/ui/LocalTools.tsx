import { useI18n } from '../i18n/context';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import { LocalToolsError, localToolsAvailable } from '../data/localTools';
import { Button, IconButton } from './primitives';

export const toolInput =
  'w-full min-w-0 rounded-xl border border-hairline bg-fill px-3 py-2 text-[14px] text-fg outline-none focus:ring-2 focus:ring-accent';
export const toolPage = 'mx-auto w-full max-w-[1040px] px-4 pt-[100px] pb-32 sm:px-6 md:pb-24';

/** Shared keyboard-accessible overlay for occasional setup and focused reading. */
export function ToolDialog({
  open,
  onOpenChange,
  title,
  description,
  side = false,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  side?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  const descriptionId = useId();
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[3px] dark:bg-black/50" />
        <Dialog.Content
          aria-describedby={description ? descriptionId : undefined}
          onOpenAutoFocus={() => {
            opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
          className={
            side
              ? 'fixed inset-y-0 right-0 z-50 flex w-full max-w-[620px] flex-col overflow-hidden border-l border-hairline bg-canvas shadow-2xl outline-none sm:inset-y-3 sm:right-3 sm:rounded-[26px] sm:border'
              : 'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-[600px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[26px] border border-hairline bg-canvas shadow-2xl outline-none'
          }
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-[19px] font-semibold tracking-tight">{title}</Dialog.Title>
              {description && (
                <Dialog.Description id={descriptionId} className="mt-1 text-[13px] leading-5 text-fg-2">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton label={t('detail.close')} className="-mr-2 -mt-1">
                <X className="size-[18px]" />
              </IconButton>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6">{children}</div>
          {footer && (
            <footer className="shrink-0 border-t border-hairline px-5 py-4 sm:px-6">{footer}</footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ToolNotice({
  error,
  loading,
  retry,
}: {
  error?: unknown;
  loading?: boolean;
  retry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div role={error ? 'alert' : 'status'} className="card mt-5 p-5 text-[14px] text-fg-2">
      <p>
        {loading
          ? t('local.loading')
          : !localToolsAvailable
            ? t('local.notHosted')
            : error instanceof LocalToolsError && error.message === 'INVALID_RESULT'
              ? t('resumeTools.invalidFacts')
              : error instanceof LocalToolsError && !error.unavailable && error.message !== 'REQUEST_FAILED'
                ? error.message
                : error instanceof LocalToolsError && !error.unavailable
                  ? t('local.failed')
                  : t('local.offline')}
      </p>
      {retry && !loading && localToolsAvailable && (
        <Button className="mt-3" onClick={retry}>
          {t('local.retry')}
        </Button>
      )}
    </div>
  );
}
