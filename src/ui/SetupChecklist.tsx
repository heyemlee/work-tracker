import clsx from 'clsx';
import { ArrowRight, Check, ChevronRight, X } from 'lucide-react';
import { useExtension } from '../data/extension';
import { useProfile } from '../data/store';
import {
  GUIDE_STEP,
  hideNudge,
  nextStep,
  nudgeShown,
  setupProgress,
  SETUP_STEPS,
  type SetupStep,
} from '../domain/setup';
import type { Snapshot } from '../domain/types';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useI18n } from '../i18n/context';
import { updateSetup, usePrefs } from '../state/prefs';
import { PAGE_PATHS } from '../state/router';
import { Link } from './Link';
import { IconButton } from './primitives';

/**
 * What's left of setting up, on the home page until it's all done. Hidden once it comes back a week later; hidden
 * twice it stays hidden, and the account menu still has the guide.
 */
export function SetupChecklist({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useI18n();
  const setup = usePrefs((p) => p.setup);
  const extension = useExtension();
  const profile = useProfile();
  const roomy = useMediaQuery('(min-width: 640px)');
  if (profile.isPending || !nudgeShown(setup, new Date())) return null;

  const progress = setupProgress({
    accounts: snapshot.accounts.length,
    resumes: snapshot.resumes.filter((resume) => resume.file).length,
    extensionReady: extension.state === 'ready' || setup.extensionReady,
    profile: profile.data?.profile ?? null,
    extensionLogged: extension.logged || setup.extensionLogged,
  });
  const next = nextStep(progress);
  if (next === null) return null;
  const done = SETUP_STEPS.filter((step) => progress[step]).length;

  const meta = (step: SetupStep): string | null => {
    if (step === 'accounts' && progress.accounts)
      return t('setup.meta.accounts', { n: snapshot.accounts.length });
    if (step === 'resumes' && progress.resumes)
      return t('setup.meta.resumes', { n: snapshot.resumes.filter((resume) => resume.file).length });
    if (step === 'extension' && !progress.extension && extension.state === 'no-key')
      return t('setup.meta.noKey');
    return null;
  };

  // Phones get one line: how far along, and the next step.
  if (!roomy)
    return (
      <Link
        to={`${PAGE_PATHS.welcome}?step=${GUIDE_STEP[next]}`}
        className="card mb-7 flex items-center gap-3 px-3.5 py-3"
      >
        <svg viewBox="0 0 36 36" className="size-8 shrink-0 -rotate-90" aria-hidden="true">
          <circle cx="18" cy="18" r="14" fill="none" strokeWidth="4" className="stroke-fill-2" />
          {done > 0 && (
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              className="stroke-accent"
              strokeDasharray={`${(done / SETUP_STEPS.length) * 88} 88`}
            />
          )}
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">
            {t('setup.title')} · {done} / {SETUP_STEPS.length}
          </span>
          <span className="block truncate text-[12px] text-fg-2">
            {t(`setup.step.${next}`)}
            {meta(next) && ` · ${meta(next)}`}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-fg-3" aria-hidden="true" />
      </Link>
    );

  return (
    <section aria-labelledby="setup-title" className="card mb-8 px-5 pt-4 pb-3">
      <div className="flex items-center gap-3">
        <h2 id="setup-title" className="text-[15px] font-semibold">
          {t('setup.title')}
        </h2>
        <span className="text-[13px] text-fg-2 tabular-nums">
          {t('setup.progress', { done, total: SETUP_STEPS.length })}
        </span>
        <IconButton
          label={t('setup.hide')}
          onClick={() => updateSetup(hideNudge(setup, new Date()))}
          className="ml-auto size-8"
        >
          <X className="size-4" />
        </IconButton>
      </div>
      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={SETUP_STEPS.length}
        aria-labelledby="setup-title"
        className="mt-2.5 h-1 overflow-hidden rounded-full bg-fill-2"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${(done / SETUP_STEPS.length) * 100}%` }}
        />
      </div>
      <ol className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {SETUP_STEPS.map((step) => {
          const complete = progress[step];
          const current = step === next;
          const note = meta(step);
          return (
            <li key={step}>
              <Link
                to={`${PAGE_PATHS.welcome}?step=${GUIDE_STEP[step]}`}
                className={clsx(
                  'flex min-h-10 items-center gap-2.5 rounded-[12px] px-2.5 py-2 transition-colors hover:bg-fill',
                  current && 'bg-fill',
                )}
              >
                <span
                  aria-hidden="true"
                  className={clsx(
                    'grid size-5 shrink-0 place-items-center rounded-full',
                    complete
                      ? 'bg-accent text-on-accent'
                      : current
                        ? 'border-2 border-fg'
                        : 'border-[1.5px] border-fg-3/60',
                  )}
                >
                  {complete && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span
                  className={clsx(
                    'min-w-0 flex-1 truncate text-[14px]',
                    complete ? 'text-fg-2' : current && 'font-semibold',
                  )}
                >
                  {t(`setup.step.${step}`)}
                  <span className="sr-only">{complete ? ' ✓' : ''}</span>
                </span>
                {note && (
                  <span
                    className={clsx(
                      'shrink-0 text-[12px]',
                      current && step === 'extension' ? 'text-[var(--st-oa)]' : 'text-fg-3',
                    )}
                  >
                    {note}
                  </span>
                )}
                {current && (
                  <span className="flex shrink-0 items-center gap-0.5 text-[12px] font-semibold">
                    {t('setup.go')}
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
