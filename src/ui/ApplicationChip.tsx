import clsx from 'clsx';
import { Check } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { patchApplication, useRepository } from '../data/store';
import type { Repository } from '../domain/repository';
import { STAGES, type Account, type Application } from '../domain/types';
import { useI18n } from '../i18n/context';
import { formatShortDate } from '../i18n/format';

const stop = (event: SyntheticEvent) => event.stopPropagation();

function MenuOption({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[14px] hover:bg-fill focus-visible:bg-fill focus-visible:outline-none"
    >
      <span className="flex flex-1 items-center gap-2">{children}</span>
      {selected && <Check className="size-4 text-fg-2" aria-hidden="true" />}
    </button>
  );
}

/** One account's application on a job. Click to change its stage or mark it rejected, without opening the job. */
export function ApplicationChip({ application, account }: { application: Application; account: Account }) {
  const { t, locale } = useI18n();
  const run = useRepository();
  const [open, setOpen] = useState(false);
  const stageLabel = t(`status.${application.stage}`);
  const statusLabel = application.rejected ? `${stageLabel}, ${t('status.rejected')}` : stageLabel;

  const choose = (operation: (repo: Repository) => Promise<void>, patch: Partial<Application>) => {
    setOpen(false);
    void run(operation, { optimistic: patchApplication(application.id, patch) });
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="chip"
          data-status={application.rejected ? 'rejected' : application.stage}
          aria-label={t('chip.changeStatus', { account: account.label, status: statusLabel })}
          onClick={stop}
          onKeyDown={stop}
        >
          <span className="dot" style={{ background: `var(--acc-${account.color})` }} />
          <span className="font-semibold">{account.label}</span>
          <span className="chip-status">{stageLabel}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-keep-panel=""
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          onClick={stop}
          onKeyDown={stop}
          className={clsx(
            'glass glass-strong z-50 w-64 rounded-[18px] p-1.5 outline-none',
            'origin-(--radix-popover-content-transform-origin) data-[state=open]:animate-[pop-in_160ms_ease-out]',
          )}
        >
          <div className="px-2.5 pt-1.5 pb-2">
            <div className="flex items-center gap-1.5 text-[14px]">
              <span className="dot" style={{ background: `var(--acc-${account.color})` }} />
              <span className="font-semibold">{account.label}</span>
              <span className="truncate text-fg-2">{account.email}</span>
            </div>
            <p className="mt-0.5 text-[12px] text-fg-3">
              {t('chip.appliedOn', { date: formatShortDate(application.appliedAt, locale) })}
            </p>
          </div>
          <div className="mx-2 mb-1 h-px bg-hairline" />
          {STAGES.map((stage) => (
            <MenuOption
              key={stage}
              selected={application.stage === stage}
              onSelect={() => choose((repo) => repo.setStage(application.id, stage), { stage })}
            >
              {t(`status.${stage}`)}
            </MenuOption>
          ))}
          <div className="mx-2 my-1 h-px bg-hairline" />
          <MenuOption
            selected={application.rejected}
            onSelect={() =>
              choose((repo) => repo.setRejected(application.id, !application.rejected), {
                rejected: !application.rejected,
              })
            }
          >
            {t('status.rejected')}
          </MenuOption>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
