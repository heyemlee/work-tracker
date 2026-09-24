import { FlaskConical, RotateCcw } from 'lucide-react';
import { useResetDemo } from '../data/demo';
import { useI18n } from '../i18n/context';
import { Button } from './primitives';

/** Tells a demo visitor what they're looking at, and lets them start over. */
export function DemoBanner() {
  const { t } = useI18n();
  const reset = useResetDemo();
  return (
    <div className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-[20px] bg-fill py-3 pr-3 pl-4">
      <FlaskConical className="size-5 shrink-0 text-fg-2" aria-hidden="true" />
      <p className="min-w-[200px] flex-1 text-[13px] text-fg-2">
        <span className="font-semibold text-fg">{t('demo.title')}</span> {t('demo.body')}
        <span className="hidden md:inline"> {t('demo.tryIt')}</span>
      </p>
      {/* When the text wraps it onto its own line on a phone, the button keeps to the right. */}
      <Button className="ml-auto" onClick={() => void reset()}>
        <RotateCcw className="size-3.5" aria-hidden="true" />
        {t('tweaks.reset')}
      </Button>
    </div>
  );
}
