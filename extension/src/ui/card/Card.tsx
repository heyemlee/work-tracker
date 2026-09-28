import { ChevronDown, ChevronRight, Settings, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { adapterFor } from '../../content/adapters';
import { toBackground, type CardState, type ChecklistItem } from '../../messages';
import type { FieldStatus } from '../../model';
import { getSettings } from '../../storage';
import { resolveLanguage, translator, type MessageKey, type Translate } from '../i18n';

const GROUPS: { status: FieldStatus; key: MessageKey; dot: string }[] = [
  { status: 'confirm', key: 'group.confirm', dot: 'yellow' },
  { status: 'missing', key: 'group.missing', dot: 'red' },
  { status: 'draft', key: 'group.draft', dot: 'blue' },
  { status: 'filled', key: 'group.filled', dot: 'green' },
];

function errorText(error: string, t: Translate): string {
  if (error.startsWith('ai: ')) return t('error.ai', { detail: error.slice(4) });
  const key = `error.${error}` as MessageKey;
  return t(key);
}

function Checklist({ items, t }: { items: ChecklistItem[]; t: Translate }) {
  const [closed, setClosed] = useState<Partial<Record<FieldStatus, boolean>>>({ filled: true });
  return (
    <>
      {GROUPS.map(({ status, key, dot }) => {
        const group = items.filter((item) => item.status === status);
        if (group.length === 0) return null;
        const isClosed = closed[status] ?? false;
        return (
          <div className="group" key={status}>
            <button
              className="group-head"
              onClick={() => setClosed({ ...closed, [status]: !isClosed })}
              aria-expanded={!isClosed}
            >
              {isClosed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <span className={`dot ${dot}`} />
              {t(key)} · {group.length}
            </button>
            {!isClosed &&
              group.map((item) => (
                <button
                  key={item.fieldId}
                  className={`item${item.critical ? ' critical' : ''}`}
                  onClick={() => void toBackground('card:focus', { fieldId: item.fieldId })}
                  title={item.label}
                >
                  <span className="item-label">{item.label || '—'}</span>
                  <span className="item-tag">
                    {item.source === 'ai'
                      ? t('aiNote')
                      : item.source === 'memory'
                        ? t('memoryNote')
                        : item.critical
                          ? '!'
                          : ''}
                  </span>
                  {(item.value || item.note) && <span className="item-value">{item.value ?? item.note}</span>}
                </button>
              ))}
          </div>
        );
      })}
    </>
  );
}

export function Card({ startOpen }: { startOpen: boolean }) {
  const [state, setState] = useState<CardState | null>(null);
  const [open, setOpen] = useState(startOpen);
  const [t, setT] = useState<Translate>(() => translator('en'));
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = useCallback(() => {
    toBackground('card:state', { refresh: true })
      .then((next) => {
        setState(next);
        // Open on application forms, and on the confirmation page to show the log with its Undo.
        if ((next.hasForm && next.ats !== 'generic') || (next.logged && !next.logged.undone)) setOpen(true);
      })
      .catch(() => undefined);
  }, []);

  const fill = useCallback(() => {
    setOpen(true);
    toBackground('card:fill', {})
      .then(setState)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void getSettings().then((settings) => setT(() => translator(resolveLanguage(settings.language))));
    refresh();
    const listener = (
      message: { type?: string; state?: CardState },
      _sender: unknown,
      // Answering tells the service worker there's a card here.
      sendResponse: (reply: boolean) => void,
    ) => {
      if (message.type === 'card:update' && message.state) {
        setState(message.state);
        if (message.state.logged && !message.state.logged.undone) setOpen(true);
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
        refresh();
      }
    }, 1000);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
      clearInterval(timer);
    };
  }, [refresh, fill]);

  if (!state) return null;
  if (!open) {
    if (!state.hasForm && !state.posting) return null;
    return (
      <button
        className="pill glass"
        // Read the page again: it may have drawn its form since the card last looked.
        onClick={() => {
          setOpen(true);
          refresh();
        }}
        aria-label={t('expand')}
      >
        <span className={`dot ${state.match?.level ?? 'gray'}`} />
        {t('outbox')}
      </button>
    );
  }

  const select = (change: { accountId?: string | null; resumeId?: string | null }) =>
    void toBackground('card:select', change)
      .then(setState)
      .catch(() => undefined);
  const busy = state.phase === 'reading' || state.phase === 'filling';
  const years = state.match?.h1b?.years ?? [];
  const linkedin = state.ats === 'linkedin';
  const canLog =
    (state.hasForm || linkedin || state.posting !== null) && (!state.logged || state.logged.undone);

  return (
    <div className="card glass" role="dialog" aria-label="Outbox Autofill">
      <header className="head">
        <div className="head-text">
          <div className="company">{state.posting?.company ?? ' '}</div>
          <div className="title">{state.posting?.title ?? t('outbox')}</div>
        </div>
        <button
          className="icon-button"
          onClick={() => void toBackground('card:options', {})}
          aria-label={t('options')}
          title={t('options')}
        >
          <Settings size={14} />
        </button>
        <button
          className="icon-button"
          onClick={() => setOpen(false)}
          aria-label={t('close')}
          title={t('close')}
        >
          <X size={14} />
        </button>
      </header>

      <div className="body">
        {state.match && (
          <section className={`match ${state.match.level}`}>
            <div className="match-head">
              <span className={`dot ${state.match.level}`} />
              {t(`match.${state.match.level}`)}
            </div>
            {state.match.signals.map((signal) => (
              <div className="signal" key={signal.code} title={signal.evidence}>
                <span className={`dot ${signal.level}`} />
                <span>
                  {t(`signal.${signal.code}`, {
                    n: signal.evidence,
                    from: years[0] ?? '',
                    to: years[years.length - 1] ?? '',
                  })}
                </span>
              </div>
            ))}
          </section>
        )}

        {state.error && <div className="error">{errorText(state.error, t)}</div>}
        {!state.profileLoaded && !state.error && <div className="error">{t('error.profile')}</div>}
        {state.outbox !== 'connected' && <div className="warn">{t(`outbox.${state.outbox}`)}</div>}
        {linkedin && <div className="note">{t('linkedin')}</div>}
        {!state.hasForm && !linkedin && <div className="note">{t('noForm')}</div>}

        {state.accounts.length > 0 && (
          <section>
            <div className="label">{t('applyAs')}</div>
            <div className="chips">
              {state.accounts.map((account) => (
                <button
                  key={account.id}
                  className="chip"
                  aria-pressed={account.id === state.accountId}
                  disabled={account.applied}
                  onClick={() => select({ accountId: account.id })}
                  title={account.email}
                >
                  <span className="dot" style={{ background: `var(--acc-${account.color})` }} />
                  <span>{account.email}</span>
                  {account.applied && <small>{t('applied')}</small>}
                </button>
              ))}
            </div>
          </section>
        )}
        {state.duplicateHint && <div className="warn">{t('duplicate')}</div>}

        {state.hasForm && (
          <section>
            <div className="label">{t('resume')}</div>
            {state.resumes.length ? (
              <select
                className="select"
                value={state.resumeId ?? ''}
                onChange={(event) => select({ resumeId: event.target.value })}
              >
                {state.resumes.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="note">{t('noResume')}</div>
            )}
          </section>
        )}

        {state.hasForm && (
          <button className="primary" disabled={busy || !state.profileLoaded} onClick={fill}>
            {busy && <span className="spinner" />}
            {state.phase === 'reading'
              ? t('reading')
              : state.phase === 'filling'
                ? t('filling')
                : state.checklist.length
                  ? t('refill')
                  : t('fill')}
            {!busy && <kbd>{t('shortcut')}</kbd>}
          </button>
        )}

        {state.logged && (
          <div className="toast">
            <span>{state.logged.undone ? t('undone') : t('logged')}</span>
            {!state.logged.undone && (
              <button className="secondary" onClick={() => void toBackground('card:undo', {}).then(setState)}>
                {t('undo')}
              </button>
            )}
          </div>
        )}

        {state.checklist.length > 0 && <Checklist items={state.checklist} t={t} />}

        {state.phase === 'drafting' && (
          <div className="note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="spinner" /> {t('drafting')}
          </div>
        )}
        {state.ai === 'noKey' && state.checklist.some((item) => item.status === 'missing') && (
          <div className="note">{t('ai.noKey')}</div>
        )}
        {flash && <div className="note">{flash}</div>}

        <div className="foot">
          {state.hasForm ? (
            <button
              className="link"
              onClick={() =>
                void toBackground('card:snapshot', {}).then(({ saved }) => {
                  if (saved) setFlash(t('snapshotSaved'));
                })
              }
            >
              {t('snapshot')}
            </button>
          ) : (
            <span />
          )}
          {canLog && (
            <button className="secondary" onClick={() => void toBackground('card:log', {}).then(setState)}>
              {t('log')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
