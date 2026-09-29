import { CircleCheck, Ellipsis, FileText, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { adapterFor } from '../../content/adapters';
import { toBackground, type CardState, type ChecklistItem } from '../../messages';
import type { Signal } from '../../match/scan';
import { DEFAULT_SETTINGS, getSettings } from '../../storage';
import { resolveLanguage, translator, type MessageKey, type Translate } from '../i18n';

const TAGS: Partial<Record<ChecklistItem['status'], { key: MessageKey; tone: string }>> = {
  confirm: { key: 'tag.confirm', tone: 'yellow' },
  draft: { key: 'tag.draft', tone: 'blue' },
  missing: { key: 'tag.missing', tone: 'red' },
};

/** At most one line above the controls: what's wrong, and where to fix it. */
interface Notice {
  tone: 'error' | 'warn';
  text: string;
  action?: { label: string; href: string } | { label: string; run: () => void };
}

function noticeFor(state: CardState, t: Translate, outboxUrl: string): Notice | null {
  const outbox = (label: string) => ({ label, href: outboxUrl });
  if (state.error === 'profile' || (!state.profileLoaded && state.hasForm))
    return { tone: 'error', text: t('notice.profile'), action: outbox(t('action.fillIn')) };
  if (state.error === 'signedOut' || state.outbox === 'signedOut')
    return {
      tone: state.error ? 'error' : 'warn',
      text: t('notice.signedOut'),
      action: outbox(t('action.signIn')),
    };
  if (state.error?.startsWith('ai: '))
    return { tone: 'error', text: t('error.ai', { detail: state.error.slice(4) }) };
  if (state.error)
    return {
      tone: state.error === 'queued' ? 'warn' : 'error',
      text: t(`error.${state.error}` as MessageKey),
    };
  if (state.outbox === 'unreachable') return { tone: 'warn', text: t('notice.unreachable') };
  if (state.ai === 'noKey' && state.checklist.some((item) => item.status === 'missing'))
    return {
      tone: 'warn',
      text: t('notice.noKey'),
      action: { label: t('action.settings'), run: () => void toBackground('card:options', {}) },
    };
  return null;
}

/**
 * The ⋯ menu: what's needed now and then. Closes when focus leaves it. It drops down, or opens upward when the card
 * is too short for it near the bottom of the window.
 */
function Menu({ items, label }: { items: { label: string; run: () => void }[]; label: string }) {
  const [open, setOpen] = useState<'down' | 'up' | null>(null);
  return (
    <div
      className="menu-wrap"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(null);
      }}
    >
      <button
        className="icon-button"
        onClick={(event) => {
          const below = window.innerHeight - event.currentTarget.getBoundingClientRect().bottom;
          setOpen(open ? null : below > items.length * 32 + 24 ? 'down' : 'up');
        }}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-label={label}
        title={label}
      >
        <Ellipsis size={14} />
      </button>
      {open && (
        <div className={`menu glass ${open}`} role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => {
                setOpen(null);
                item.run();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** After filling: only what needs the owner. What filled fine is a count. */
function Attention({ items, t }: { items: ChecklistItem[]; t: Translate }) {
  const open = items.filter((item) => TAGS[item.status]);
  if (open.length === 0) return null;
  return (
    <div className="items">
      {open.map((item) => {
        const tag = TAGS[item.status]!;
        // A short value is worth checking at a glance (an authorization answer); a draft is read on the page.
        const value = item.value && item.value.length <= 40 ? item.value : null;
        return (
          <button
            key={item.fieldId}
            className="item"
            onClick={() => void toBackground('card:focus', { fieldId: item.fieldId })}
            title={item.label}
          >
            <span className={`tag ${tag.tone}`}>{t(tag.key)}</span>
            <span className="item-label">{item.label || '—'}</span>
            {value && <span className="item-value">{value}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Card({ startOpen }: { startOpen: boolean }) {
  const [state, setState] = useState<CardState | null>(null);
  const [open, setOpen] = useState(startOpen);
  const [t, setT] = useState<Translate>(() => translator('en'));
  const [outboxUrl, setOutboxUrl] = useState(DEFAULT_SETTINGS.outboxUrl);
  const [flash, setFlash] = useState<string | null>(null);
  // Logged while this page was showing: the page is the confirmation, even where it kept its address and the form
  // is still counted. On another page with a form (the same posting, another account) the card fills again.
  const [loggedHere, setLoggedHere] = useState(false);

  // A request that failed in the service worker answers nothing: the card keeps what it shows.
  const apply = useCallback((next: CardState | undefined) => {
    if (next) setState(next);
  }, []);

  const refresh = useCallback(() => {
    toBackground('card:state', { refresh: true })
      .then((next) => {
        if (!next) return;
        setState(next);
        // Open where there's something to do: an application form, a posting on an applicant-tracking site or
        // LinkedIn (its match check, before applying), the confirmation page with its Undo. Elsewhere the detect
        // script opens the card for a form with a resume upload.
        const show =
          (next.ats !== 'generic' && (next.hasForm || Boolean(next.posting?.title))) ||
          (next.logged && !next.logged.undone);
        if (show) setOpen(true);
      })
      .catch(() => undefined);
  }, []);

  const fill = useCallback(() => {
    setOpen(true);
    toBackground('card:fill', {})
      .then(apply)
      .catch(() => undefined);
  }, [apply]);

  useEffect(() => {
    void getSettings().then((settings) => {
      setT(() => translator(resolveLanguage(settings.language)));
      setOutboxUrl(settings.outboxUrl);
    });
    refresh();
    const listener = (
      message: { type?: string; state?: CardState },
      _sender: unknown,
      // Answering tells the service worker there's a card here.
      sendResponse: (reply: boolean) => void,
    ) => {
      if (message.type === 'card:update' && message.state) {
        setState(message.state);
        if (message.state.logged && !message.state.logged.undone) {
          setOpen(true);
          setLoggedHere(true);
        }
      }
      if (message.type === 'card:open') {
        setOpen(true);
        refresh();
        sendResponse(true);
      }
      if (message.type === 'card:fill') {
        fill();
        sendResponse(true);
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(listener);
    // Workday moves between steps without loading a page, often at the same address:
    // read again when the address or the step changes.
    const where = () => `${location.href}\n${adapterFor(location.href).step?.(document) ?? ''}`;
    let seen = where();
    const timer = setInterval(() => {
      const now = where();
      if (now !== seen) {
        seen = now;
        setLoggedHere(false);
        refresh();
      }
    }, 1000);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
      clearInterval(timer);
    };
  }, [refresh, fill]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  // Closed, the card is gone until the page changes or the toolbar button is pressed; no pill waits in the corner.
  if (!state || !open) return null;

  const log = () =>
    void toBackground('card:log', {})
      .then((next) => {
        apply(next);
        if (next?.logged) setLoggedHere(true);
      })
      .catch(() => undefined);
  const close = (
    <button className="icon-button" onClick={() => setOpen(false)} aria-label={t('close')} title={t('close')}>
      <X size={14} />
    </button>
  );
  const posting = [state.posting?.company, state.posting?.title].filter(Boolean).join(' · ');
  const notice = noticeFor(state, t, outboxUrl);
  const noticeLine = notice && (
    <div className={`notice ${notice.tone}`}>
      <span title={notice.text}>{notice.text}</span>
      {notice.action &&
        ('href' in notice.action ? (
          <a className="notice-action" href={notice.action.href} target="_blank" rel="noreferrer">
            {notice.action.label}
          </a>
        ) : (
          <button className="notice-action" onClick={notice.action.run}>
            {notice.action.label}
          </button>
        ))}
    </div>
  );

  // Submitted and logged: the one thing left is Undo, and why it failed if it did.
  if (state.logged && (loggedHere || !state.hasForm)) {
    const { undone } = state.logged;
    return (
      <div className="card glass" role="dialog" aria-label="Outbox Autofill">
        <div className="done">
          {undone ? (
            <RotateCcw size={16} className="done-icon" />
          ) : (
            <CircleCheck size={18} className="done-icon ok" />
          )}
          <div className="done-text">
            <div className="done-title">{undone ? t('undone') : t('logged')}</div>
            {posting && <div className="done-posting">{posting}</div>}
          </div>
          {undone ? (
            <button className="secondary" onClick={log}>
              {t('relog')}
            </button>
          ) : (
            <button
              className="secondary"
              onClick={() =>
                void toBackground('card:undo', {})
                  .then(apply)
                  .catch(() => undefined)
              }
            >
              {t('undo')}
            </button>
          )}
          {close}
        </div>
        {state.error && <div className="body">{noticeLine}</div>}
      </div>
    );
  }

  const select = (change: { accountId?: string | null; resumeId?: string | null }) =>
    void toBackground('card:select', change)
      .then(apply)
      .catch(() => undefined);
  const busy = state.phase === 'reading' || state.phase === 'filling';
  const linkedin = state.ats === 'linkedin';
  const canLog =
    (state.hasForm || linkedin || state.posting !== null) && (!state.logged || state.logged.undone);

  const years = state.match?.h1b?.years ?? [];
  const signalText = (signal: Signal) =>
    t(`signal.${signal.code}`, {
      n: signal.evidence,
      from: years[0] ?? '',
      to: years[years.length - 1] ?? '',
    });
  const match = state.match;
  const reasons = match?.signals.filter((signal) => signal.level !== 'green').slice(0, 2) ?? [];

  const account =
    state.accounts.find((item) => item.id === state.accountId) ??
    (state.accounts.length === 1 ? state.accounts[0]! : null);
  const accountText = (item: CardState['accounts'][number]) =>
    item.applied ? `${item.email} · ${t('applied')}` : item.email;
  const filled = state.checklist.filter((item) => item.status === 'filled').length;
  const waiting = state.checklist.filter((item) => TAGS[item.status]).length;

  const menu = [
    ...(canLog && !linkedin ? [{ label: t('log'), run: log }] : []),
    ...(state.hasForm
      ? [
          {
            label: t('snapshot'),
            run: () =>
              void toBackground('card:snapshot', {}).then(({ saved }) => {
                if (saved) setFlash(t('snapshotSaved'));
              }),
          },
        ]
      : []),
    { label: t('options'), run: () => void toBackground('card:options', {}) },
  ];

  let main: ReactNode = null;
  if (state.hasForm) {
    main =
      busy || state.checklist.length === 0 ? (
        <button
          className="primary"
          disabled={busy || !state.profileLoaded}
          onClick={fill}
          title={t('shortcut')}
        >
          {busy && <span className="spinner" />}
          {state.phase === 'reading' ? t('reading') : state.phase === 'filling' ? t('filling') : t('fill')}
        </button>
      ) : (
        <div className="summary">
          <span>
            {waiting ? t('summary', { filled, n: waiting }) : t('summaryDone', { filled })}
            {state.phase === 'drafting' && (
              <>
                {' · '}
                <span className="spinner small" /> {t('drafting')}
              </>
            )}
          </span>
          {/* While AI writes, filling again would race it. */}
          {state.phase !== 'drafting' && (
            <button className="link" onClick={fill} title={t('shortcut')}>
              {t('refill')}
            </button>
          )}
        </div>
      );
  } else if (linkedin && canLog) {
    main = (
      <button className="primary" onClick={log}>
        {t('log')}
      </button>
    );
  }

  return (
    <div className="card glass" role="dialog" aria-label="Outbox Autofill">
      <header className="head">
        <div
          className="head-text"
          title={match ? [t(`match.${match.level}`), ...match.signals.map(signalText)].join('\n') : undefined}
        >
          {state.posting?.company && <div className="company">{state.posting.company}</div>}
          <div className="title">
            {match && <span className={`dot ${match.level}`} />}
            <span>{state.posting?.title ?? t('outbox')}</span>
          </div>
        </div>
        <Menu items={menu} label={t('more')} />
        {close}
      </header>

      <div className="body">
        {reasons.length > 0 && (
          <div className={`reasons ${match!.level}`}>{reasons.map(signalText).join(' · ')}</div>
        )}

        {noticeLine}

        {(state.hasForm || (linkedin && state.accounts.length > 0)) && (
          <div className="pickers">
            {state.accounts.length > 0 && (
              <label
                className={`picker account${state.accounts.length > 1 ? ' choosable' : ''}`}
                title={t('account')}
              >
                <span className="dot" style={{ background: `var(--acc-${account?.color ?? 'gray'})` }} />
                {state.accounts.length > 1 ? (
                  <select
                    value={state.accountId ?? ''}
                    onChange={(event) => select({ accountId: event.target.value })}
                    aria-label={t('account')}
                  >
                    {!state.accountId && <option value="" disabled />}
                    {state.accounts.map((item) => (
                      <option key={item.id} value={item.id} disabled={item.applied}>
                        {accountText(item)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="fixed">{accountText(state.accounts[0]!)}</span>
                )}
              </label>
            )}
            {state.hasForm && (
              <label
                className={`picker resume${state.resumes.length > 1 ? ' choosable' : ''}`}
                title={t('resume')}
              >
                <FileText size={13} className="picker-icon" />
                {state.resumes.length > 1 ? (
                  <select
                    value={state.resumeId ?? ''}
                    onChange={(event) => select({ resumeId: event.target.value })}
                    aria-label={t('resume')}
                  >
                    {state.resumes.map((resume) => (
                      <option key={resume.id} value={resume.id}>
                        {resume.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="fixed">{state.resumes[0]?.label ?? t('noResume')}</span>
                )}
              </label>
            )}
          </div>
        )}
        {state.duplicateHint && <div className="hint">{t('duplicate')}</div>}

        {main}
        {!busy && <Attention items={state.checklist} t={t} />}
        {flash && <div className="hint">{flash}</div>}
      </div>
    </div>
  );
}
