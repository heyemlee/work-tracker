import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { initialAuthError, signInWithGoogle } from '../data/auth';
import { DEMO_FAILURE_MESSAGES, startDemo, type DemoStart as DemoOutcome } from '../data/demo';
import { ME_KEY } from '../data/store';
import { useI18n } from '../i18n/context';
import { updatePrefs } from '../state/prefs';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { BrandMark, Button } from './primitives';

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

/** The glass card the sign-in and demo screens share. */
function GateCard({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const { locale } = useI18n();
  const paneRef = useRef<HTMLDivElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: 32, bevel: 20 });
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <motion.div
        className="w-full max-w-[400px]"
        initial={delay ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ delay, duration: 0.3 }}
      >
        <div ref={paneRef} style={glass.style} className="glass rounded-[32px] px-8 pt-10 pb-7 text-center">
          {glass.filter}
          <div className="flex justify-center">
            <BrandMark size={56} />
          </div>
          <h1 className="mt-5 text-[28px] font-semibold tracking-[-0.025em]">Outbox</h1>
          {children}
          <button
            type="button"
            onClick={() => updatePrefs({ locale: locale === 'en' ? 'zh' : 'en' })}
            className="mt-6 text-[12px] text-fg-3 hover:text-fg"
          >
            {locale === 'en' ? '中文' : 'English'}
          </button>
        </div>
      </motion.div>
    </main>
  );
}

export function SignIn({ demoUrl }: { demoUrl: string | null }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // Better Auth reports a blocked sign-up as unable_to_create_user: the account isn't on the allowlist.
  const redirectError = initialAuthError
    ? t(initialAuthError === 'unable_to_create_user' ? 'signIn.notAllowed' : 'signIn.incomplete')
    : null;

  const start = async () => {
    setPending(true);
    setFailed(false);
    try {
      await signInWithGoogle();
    } catch {
      setFailed(true);
      setPending(false);
    }
  };

  return (
    <GateCard>
      <p className="mt-1 text-[17px] text-fg-2">{t('signIn.title')}</p>
      <p className="mx-auto mt-5 max-w-[280px] text-[13px] leading-relaxed text-fg-3">{t('signIn.body')}</p>
      <Button
        variant="primary"
        className="mt-7 h-11 w-full gap-2.5 text-[15px]"
        disabled={pending}
        onClick={() => void start()}
      >
        <span className="grid size-6 place-items-center rounded-full bg-white">
          <GoogleMark />
        </span>
        {t('signIn.google')}
      </Button>
      {(failed || (redirectError && !pending)) && (
        <p role="alert" className="mt-3 text-[12px] text-danger">
          {failed ? t('signIn.failed') : redirectError}
        </p>
      )}
      {demoUrl && (
        <a
          href={demoUrl}
          className="mt-2.5 flex h-11 w-full items-center justify-center rounded-full bg-fill text-[15px] font-medium transition hover:bg-fill-2 active:scale-[0.97]"
        >
          {t('signIn.demo')}
        </a>
      )}
    </GateCard>
  );
}

/** The public demo's front door: creates the visitor's sandbox, then lets the app load it. */
export function DemoStart() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<Exclude<DemoOutcome, 'started'> | null>(null);

  useEffect(() => {
    let current = true;
    void startDemo().then((outcome) => {
      if (!current) return;
      if (outcome === 'started') void queryClient.invalidateQueries({ queryKey: ME_KEY });
      else setFailure(outcome);
    });
    return () => {
      current = false;
    };
  }, [attempt, queryClient]);

  return (
    // Usually done in a blink: wait a moment before showing anything, so the card doesn't flash.
    <GateCard delay={0.4}>
      {failure ? (
        <>
          <p role="alert" className="mx-auto mt-3 max-w-[300px] text-[14px] text-fg-2">
            {t(DEMO_FAILURE_MESSAGES[failure])}
          </p>
          <Button
            className="mt-6 h-11 w-full text-[15px]"
            onClick={() => {
              setFailure(null);
              setAttempt((n) => n + 1);
            }}
          >
            {t('error.retry')}
          </Button>
        </>
      ) : (
        <p className="mt-3 flex items-center justify-center gap-2 text-[14px] text-fg-2">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          {t('demo.starting')}
        </p>
      )}
    </GateCard>
  );
}
