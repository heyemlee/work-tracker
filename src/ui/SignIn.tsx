import { useRef, useState } from 'react';
import { initialAuthError, signInWithGoogle } from '../data/auth';
import { useI18n } from '../i18n/context';
import { updatePrefs } from '../state/prefs';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { Pet } from './pet/Pet';
import { Button } from './primitives';

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

export function SignIn() {
  const { t, locale } = useI18n();
  const paneRef = useRef<HTMLDivElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: 32, bevel: 20 });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // The pointer or the keyboard on the button: the pet looks down at it.
  const [eyeing, setEyeing] = useState(false);
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
    <main className="grid min-h-dvh place-items-center p-4">
      <div
        ref={paneRef}
        style={glass.style}
        className="glass w-full max-w-[400px] rounded-[32px] px-8 pt-10 pb-7 text-center"
      >
        {glass.filter}
        {/* Waiting on Google, it turns into the loading dots; a sign-in that didn't go through, it shakes. */}
        <div className="-mt-3 flex justify-center">
          <Pet
            size={92}
            fit="stage"
            shadow
            mood={pending ? 'think' : failed || redirectError ? 'oops' : 'idle'}
            look={eyeing && !pending ? 'down' : null}
          />
        </div>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.025em]">Outbox</h1>
        <p className="mx-auto mt-3 max-w-[280px] text-[13px] leading-relaxed text-fg-3">{t('signIn.body')}</p>
        <Button
          variant="primary"
          className="mt-7 h-11 w-full gap-2.5 text-[15px]"
          disabled={pending}
          onClick={() => void start()}
          onPointerEnter={() => setEyeing(true)}
          onPointerLeave={() => setEyeing(false)}
          onFocus={() => setEyeing(true)}
          onBlur={() => setEyeing(false)}
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
        <button
          type="button"
          onClick={() => updatePrefs({ locale: locale === 'en' ? 'zh' : 'en' })}
          className="mt-6 text-[12px] text-fg-3 hover:text-fg"
        >
          {locale === 'en' ? '中文' : 'English'}
        </button>
      </div>
    </main>
  );
}
