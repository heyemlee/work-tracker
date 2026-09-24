import { FlaskConical, RotateCcw } from 'lucide-react';
import { useResetDemo } from '../data/demo';
import { useI18n } from '../i18n/context';
import { Button } from './primitives';

/**
 * Tells a demo visitor what they're looking at, and lets them start over: a banner above a phone's list, a card
 * at the bottom of the sidebar elsewhere.
 */
export function DemoBanner({ variant = 'banner' }: { variant?: 'banner' | 'card' }) {
  const { t } = useI18n();
  const reset = useResetDemo();

  if (variant === 'card') {
    return (
      <div className="rounded-[16px] bg-fill p-3 text-[12px] leading-snug text-fg-2">
        <p>
          <span className="font-semibold text-fg">{t('demo.title')}</span> {t('demo.body')}
        </p>
        <Button className="mt-2.5 h-7 px-2.5 text-[12px]" onClick={() => void reset()}>
          <RotateCcw className="size-3" aria-hidden="true" />
          {t('tweaks.reset')}
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-[20px] bg-fill py-3 pr-3 pl-4">
      <FlaskConical className="size-5 shrink-0 text-fg-2" aria-hidden="true" />
      <p className="min-w-[200px] flex-1 text-[13px] text-fg-2">
        <span className="font-semibold text-fg">{t('demo.title')}</span> {t('demo.body')}
      </p>
      {/* When the text wraps it onto its own line on a phone, the button keeps to the right. */}
      <Button className="ml-auto" onClick={() => void reset()}>
        <RotateCcw className="size-3.5" aria-hidden="true" />
        {t('tweaks.reset')}
      </Button>
    </div>
  );
}
