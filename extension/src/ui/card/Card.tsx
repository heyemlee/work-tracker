import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Ellipsis,
  FileText,
  Minus,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { browser } from 'wxt/browser';
import { adapterFor } from '../../content/adapters';
import { toBackground, type CardState, type ChecklistItem } from '../../messages';
import type { Signal } from '../../match/scan';
import { DEFAULT_SETTINGS, getSettings } from '../../storage';
import { resolveLanguage, translator, type MessageKey, type Translate } from '../i18n';
import { ProfileSheet } from './ProfileSheet';
import { pageIsDark } from './scheme';
import { SettingsFrame } from './SettingsFrame';
import { Track } from './Track';

/** What the owner does about a field the fill left open, in a word. */
const KINDS: Partial<Record<ChecklistItem['status'], MessageKey>> = {
  confirm: 'tag.confirm',
  draft: 'tag.draft',
  missing: 'tag.missing',
};

/** The page now holds something in the field: put by a rule, kept from the page, or written by AI. */
const isDone = (item: ChecklistItem) =>
  item.status === 'filled' || item.status === 'confirm' || (item.status === 'draft' && Boolean(item.value));

interface Choice {
  id: string;
  icon: ReactNode;
  text: string;
  note?: string;
  disabled?: boolean;
}

/**
 * One of several, each on its line: the highlight sits on the chosen one and slides to the next. Arrow keys move
 * the choice. With `fold`, only the chosen line shows, like a closed dropdown: pressed, the lines drop open, and
 * they close once another is chosen.
 */
function Choices({
  label,
  value,
  choices,
  onChoose,
  fold = false,
}: {
  label: string;
  value: string | null;
  choices: Choice[];
  onChoose: (id: string) => void;
  fold?: boolean;
}) {
  const folds = fold && choices.length > 1;
  const [open, setOpen] = useState(false);
  const shut = folds && !open;
  // The lines stay open a moment after a choice, for the highlight to land on it.
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(closing.current), []);

  const free = choices.filter((choice) => !choice.disabled);
  // The one Tab stops at: the chosen one, or the first that can be.
  const stop = free.find((choice) => choice.id === value)?.id ?? free[0]?.id;
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') setOpen(false);
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step || free.length === 0) return;
    event.preventDefault();
    const from = free.findIndex((choice) => choice.id === (event.target as HTMLElement).dataset.key);
    const next = free[(from + step + free.length) % free.length]!;
    // Folded shut, the list rolls the new choice into view by itself: the browser mustn't scroll to it too.
    event.currentTarget
      .querySelector<HTMLElement>(`[data-key="${CSS.escape(next.id)}"]`)
      ?.focus({ preventScroll: true });
    if (next.id !== value) onChoose(next.id);
  };

  return (
    <div
      className={`choices${folds ? ' fold' : ''}${open ? ' open' : ''}`}
      style={
        folds
          ? ({
              '--lines': choices.length,
              '--at': Math.max(
                0,
                choices.findIndex((choice) => choice.id === value),
              ),
            } as CSSProperties)
          : undefined
      }
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Track className="lines" current={value} role="radiogroup" aria-label={label} onKeyDown={move}>
        {choices.map((choice) => {
          const chosen = choice.id === value;
          return (
            <button
              key={choice.id}
              data-key={choice.id}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-hidden={shut && !chosen ? true : undefined}
              disabled={choice.disabled}
              tabIndex={choice.id === stop ? 0 : -1}
              className="choice"
              onClick={() => {
                clearTimeout(closing.current);
                if (shut) setOpen(true);
                else if (chosen) setOpen(false);
                else {
                  onChoose(choice.id);
                  if (folds) closing.current = setTimeout(() => setOpen(false), 280);
                }
              }}
            >
              <span className="choice-icon">{choice.icon}</span>
              <span className="choice-text">{choice.text}</span>
              {choice.note && <span className="choice-note">{choice.note}</span>}
              {folds && chosen && <ChevronDown size={14} className={`choice-fold${open ? ' up' : ''}`} />}
            </button>
          );
        })}
      </Track>
    </div>
  );
}

/** At most one line above the controls: what's wrong, and where to fix it. */
interface Notice {
  tone: 'error' | 'warn';
  text: string;
  action?: { label: string; href: string } | { label: string; run: () => void };
}

function noticeFor(
  state: CardState,
  t: Translate,
  outboxUrl: string,
  editProfile: () => void,
  openSettings: () => void,
): Notice | null {
  const outbox = (label: string) => ({ label, href: outboxUrl });
  if (state.error === 'profile' || (!state.profile && state.hasForm))
    return {
      tone: 'error',
      text: t('notice.profile'),
      action: { label: t('action.fillIn'), run: editProfile },
    };
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
      action: { label: t('action.settings'), run: openSettings },
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

/**
 * A fill under way, as a bar that fills where the button was. The service worker says no more than which stage
 * it's at, so within a stage the bar is paced by the clock: it closes on a mark it only passes when the stage ends,
 * and reaches the end when the fill does.
 */
function Progress({ stage, label }: { stage: 'reading' | 'filling' | 'done'; label: string }) {
  const [paced, setPaced] = useState(0);
  useEffect(() => {
    if (stage === 'done') return undefined;
    // Reading the page is the quick part; filling takes as long as the form is.
    const [mark, share] = stage === 'reading' ? [30, 0.18] : [94, 0.07];
    const timer = setInterval(() => setPaced((now) => now + (mark - now) * share), 100);
    return () => clearInterval(timer);
  }, [stage]);
  const percent = stage === 'done' ? 100 : Math.round(paced);
  const text = `${label} ${percent}%`;
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <span className="progress-text">{text}</span>
      {/* The same words again, in the fill's own color: they show only where the fill has passed. */}
      <span
        className="progress-fill"
        style={{ width: `calc((100% - 6px) * ${percent / 100})` }}
        aria-hidden="true"
      >
        <span className="progress-text">{text}</span>
      </span>
    </div>
  );
}

/**
 * After filling: every field of the form with a mark for whether it holds something, grouped by what it asks of
 * the owner: to fill, to check (work authorization, consents, AI's drafts), nothing (it filled fine), and nothing
 * either (optional, left alone).
 */
function Checklist({ items, t }: { items: ChecklistItem[]; t: Translate }) {
  // The field last jumped to keeps the highlight.
  const [at, setAt] = useState<string | null>(null);
  const standing = (status: ChecklistItem['status']) => items.filter((item) => item.status === status);
  const groups: { title: MessageKey; items: ChecklistItem[] }[] = [
    { title: 'group.fill', items: standing('missing') },
    { title: 'group.check', items: [...standing('confirm'), ...standing('draft')] },
    { title: 'group.filled', items: standing('filled') },
    { title: 'group.skipped', items: standing('skipped') },
  ];

  const line = (item: ChecklistItem) => {
    const kindKey = KINDS[item.status];
    const kind = kindKey ? t(kindKey) : null;
    // A box says "checked"; the owner reads it in their language.
    const value =
      item.value === 'checked' || item.value === 'unchecked' ? t(item.value) : item.value?.trim() || null;
    // What AI wrote says so; the rest is the answer as filled.
    const answer = value && item.status === 'draft' ? `${kind} · ${value}` : value;
    // A short answer sits beside its question (a work-authorization "Yes"); a draft starts on the line below.
    const brief = value !== null && value.length <= 24;
    const wanted = item.status === 'missing' && item.required;
    return (
      <button
        key={item.fieldId}
        data-key={item.fieldId}
        aria-current={item.fieldId === at ? 'true' : undefined}
        className="item"
        onClick={() => {
          setAt(item.fieldId);
          void toBackground('card:focus', { fieldId: item.fieldId }).catch(() => undefined);
        }}
        title={kind ? `${kind}: ${item.label}` : item.label}
      >
        {isDone(item) ? (
          <span className="mark on">
            <Check size={10} strokeWidth={3.5} />
          </span>
        ) : (
          <span className="mark">
            <Minus size={10} strokeWidth={3.5} />
          </span>
        )}
        <span className="item-text">
          <span className="item-label">{item.label || '—'}</span>
          {answer && !brief && <span className="item-sub">{answer}</span>}
        </span>
        {/* Nothing there yet: the word for what's wanted stands where the answer would. */}
        {brief ? (
          <span className="item-value">{answer}</span>
        ) : (
          !answer &&
          kind && (
            <span className={`item-value ${wanted ? 'wanted' : 'none'}`}>
              {wanted ? t('tag.required') : kind}
            </span>
          )
        )}
      </button>
    );
  };

  return groups.map(
    (group) =>
      group.items.length > 0 && (
        <section className="section" key={group.title}>
          <h2 className="label">
            {t(group.title)} <span>{group.items.length}</span>
          </h2>
          <Track className="items" current={group.items.some((item) => item.fieldId === at) ? at : null}>
            {group.items.map(line)}
          </Track>
        </section>
      ),
  );
}

export function Card({ startOpen }: { startOpen: boolean }) {
  const [state, setState] = useState<CardState | null>(null);
  const [open, setOpen] = useState(startOpen);
  // The glass takes the page's side, light or dark: see scheme.ts.
  const [dark, setDark] = useState(() => pageIsDark());
  const [t, setT] = useState<Translate>(() => translator('en'));
  const [outboxUrl, setOutboxUrl] = useState(DEFAULT_SETTINGS.outboxUrl);
  const [flash, setFlash] = useState<string | null>(null);
  // Logged while this page was showing: the page is the confirmation, even where it kept its address and the form
  // is still counted. On another page with a form (the same posting, another account) the card fills again.
  const [loggedHere, setLoggedHere] = useState(false);
  // The profile's own window is open, over the page; or the settings'.
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // A request that failed in the service worker answers nothing: the card keeps what it shows.
  const apply = useCallback((next: CardState | undefined) => {
    if (next) setState(next);
  }, []);

  const refresh = useCallback(() => {
    toBackground('card:state', { refresh: true })
      .then((next) => {
        if (!next) return;
        setState(next);
        // A page may have drawn its theme, or moved to another one, since the card last looked.
        setDark(pageIsDark());
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

  const readSettings = useCallback(
    () =>
      void getSettings().then((settings) => {
        setT(() => translator(resolveLanguage(settings.language)));
        setOutboxUrl(settings.outboxUrl);
      }),
    [],
  );

  useEffect(() => {
    readSettings();
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
  }, [refresh, fill, readSettings]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  // A fill's bar is seen through to its end: it stays a moment after the fill is over, full.
  const busy = state?.phase === 'reading' || state?.phase === 'filling';
  const [wasBusy, setWasBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  if (busy !== wasBusy) {
    setWasBusy(busy);
    setEnding(!busy);
  }
  useEffect(() => {
    if (!ending) return undefined;
    const timer = setTimeout(() => setEnding(false), 450);
    return () => clearTimeout(timer);
  }, [ending]);

  // Closed, the card is gone until the page changes or the toolbar button is pressed; no pill waits in the corner.
  if (!state || !open) return null;

  const log = () =>
    void toBackground('card:log', {})
      .then((next) => {
        apply(next);
        if (next?.logged) setLoggedHere(true);
      })
      .catch(() => undefined);
  const save = () =>
    void toBackground('card:save', {})
      .then(apply)
      .catch(() => undefined);
  const undo = () =>
    void toBackground('card:undo', {})
      .then(apply)
      .catch(() => undefined);
  const close = (
    <button className="icon-button" onClick={() => setOpen(false)} aria-label={t('close')} title={t('close')}>
      <X size={14} />
    </button>
  );
  const posting = [state.posting?.company, state.posting?.title].filter(Boolean).join(' · ');
  const frame = `card glass${dark ? ' dark' : ''}`;
  const openSettings = () => setSettingsOpen(true);
  // What the settings changed shows at once: the language, the key AI was missing, Outbox's address.
  const closeSettings = () => {
    setSettingsOpen(false);
    readSettings();
    refresh();
  };
  const notice = noticeFor(state, t, outboxUrl, () => setEditing(true), openSettings);
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
      <div className={frame} role="dialog" aria-label="Outbox Autofill">
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
            <button className="secondary" onClick={undo}>
              {t('undo')}
            </button>
          )}
          {close}
        </div>
        {state.error && <div className="body">{noticeLine}</div>}
      </div>
    );
  }

  // Saved for later from a posting: Undo, as after a log.
  if (state.saved && !state.hasForm) {
    const { undone } = state.saved;
    return (
      <div className={frame} role="dialog" aria-label="Outbox Autofill">
        <div className="done">
          {undone ? (
            <RotateCcw size={16} className="done-icon" />
          ) : (
            <CircleCheck size={18} className="done-icon ok" />
          )}
          <div className="done-text">
            <div className="done-title">{undone ? t('undone') : t('savedDone')}</div>
            {posting && <div className="done-posting">{posting}</div>}
          </div>
          <button className="secondary" onClick={undone ? save : undo}>
            {undone ? t('save') : t('undo')}
          </button>
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
  const drafting = state.phase === 'drafting';
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

  // How far the form is: by the fields it requires, where it marks any.
  const required = state.checklist.filter((item) => item.required);
  const counted = required.length > 0 ? required : state.checklist;
  const done = counted.filter(isDone).length;
  const percent = counted.length > 0 ? Math.round((done / counted.length) * 100) : 100;
  const progress = t(required.length > 0 ? 'progress.required' : 'progress.all', {
    done,
    total: counted.length,
  });

  // On a posting without a form, saving and logging are buttons of their own (below). LinkedIn keeps its log
  // button for every posting, applied to or not: its Easy Apply happens right there.
  const postingPage =
    !state.hasForm && Boolean(state.posting?.company) && (linkedin || state.tracked !== 'applied');
  const menu = [
    ...(canLog && !linkedin && !postingPage ? [{ label: t('log'), run: log }] : []),
    ...(state.hasForm
      ? [
          {
            label: t('snapshot'),
            run: () =>
              void toBackground('card:snapshot', {})
                .then((reply: { saved: number } | undefined) => {
                  if (reply?.saved) setFlash(t('snapshotSaved'));
                })
                .catch(() => undefined),
          },
        ]
      : []),
    { label: t('options'), run: openSettings },
  ];

  let main: ReactNode = null;
  if (state.hasForm) {
    main =
      busy || ending ? (
        <Progress
          stage={state.phase === 'reading' ? 'reading' : busy ? 'filling' : 'done'}
          label={state.phase === 'reading' ? t('reading') : t('filling')}
        />
      ) : state.checklist.length === 0 ? (
        <button className="primary" disabled={!state.profile} onClick={fill} title={t('shortcut')}>
          {t('fill')}
        </button>
      ) : (
        // How much of the form is filled, as a count and a bar; the fields themselves follow, below.
        <div className="summary">
          <div className="summary-line">
            <span className="summary-title">
              {progress}
              <span className="summary-percent">{percent}%</span>
            </span>
            {/* While AI writes, filling again would race it. */}
            {drafting ? (
              <span className="drafting">
                <span className="spinner small" />
                {t('drafting')}
              </span>
            ) : (
              <button className="ghost" onClick={fill} title={t('shortcut')}>
                {t('refill')}
              </button>
            )}
          </div>
          <div
            className="meter"
            role="progressbar"
            aria-label={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>
      );
  } else if (postingPage) {
    // A posting without a form yet: save it for later, or say it was applied to. On LinkedIn, applying happens right
    // there (Easy Apply), so logging comes first.
    const saveButton =
      state.tracked !== null ? null : (
        <button className={linkedin ? 'secondary' : 'primary'} onClick={save}>
          <Bookmark size={14} />
          {t('save')}
        </button>
      );
    const logButton = canLog && (
      <button className={linkedin || !saveButton ? 'primary' : 'secondary'} onClick={log}>
        {linkedin ? t('log') : t('markApplied')}
      </button>
    );
    main = (
      <>
        {state.tracked === 'saved' && <div className="hint">{t('alreadySaved')}</div>}
        <div className="actions">
          {linkedin ? (
            <>
              {logButton}
              {saveButton}
            </>
          ) : (
            <>
              {saveButton}
              {logButton}
            </>
          )}
        </div>
      </>
    );
  }

  // A form is worked through beside the page, in a panel the window's height; a posting or a log needs only a card.
  // The profile's window, when open, is the card's sibling: over the page, not inside the panel.
  return (
    <>
      <div className={`${frame}${state.hasForm ? ' panel' : ''}`} role="dialog" aria-label="Outbox Autofill">
        <header className="head">
          {/* The page already says whose posting this is: the company waits in the hover, with the match check. */}
          <div
            className="head-text"
            title={
              [posting, ...(match ? [t(`match.${match.level}`), ...match.signals.map(signalText)] : [])]
                .filter(Boolean)
                .join('\n') || undefined
            }
          >
            <div className="title">
              {match && <span className={`dot ${match.level}`} />}
              <span>{state.posting?.title ?? t('outbox')}</span>
            </div>
            {reasons.length > 0 && (
              <div className={`reasons ${match!.level}`}>{reasons.map(signalText).join(' · ')}</div>
            )}
          </div>
          <Menu items={menu} label={t('more')} />
          {close}
        </header>

        <div className="body">
          {noticeLine}

          {/* Who applies and with which resume, each choice on its own line: an address or a file name cut short
            tells nothing. */}
          {(state.hasForm || linkedin) && state.accounts.length > 0 && (
            <section className="section">
              <h2 className="label">{t('account')}</h2>
              <Choices
                label={t('account')}
                value={state.accountId}
                choices={state.accounts.map((item) => ({
                  id: item.id,
                  icon: <span className="dot" style={{ background: `var(--acc-${item.color})` }} />,
                  text: item.email,
                  note: item.applied ? t('applied') : undefined,
                  disabled: item.applied,
                }))}
                onChoose={(accountId) => select({ accountId })}
              />
            </section>
          )}
          {state.hasForm && (
            <section className="section">
              <h2 className="label">{t('resume')}</h2>
              {state.resumes.length > 0 ? (
                <Choices
                  label={t('resume')}
                  value={state.resumeId}
                  choices={state.resumes.map((resume) => ({
                    id: resume.id,
                    icon: <FileText size={14} />,
                    text: resume.label,
                  }))}
                  onChoose={(resumeId) => select({ resumeId })}
                  fold
                />
              ) : (
                <div className="choices none">{t('noResume')}</div>
              )}
            </section>
          )}
          {/* What the form is filled from, a press away from being edited right here. */}
          {state.hasForm && state.profile && (
            <section className="section">
              <h2 className="label">{t('profile')}</h2>
              <button className="choices link" onClick={() => setEditing(true)} title={t('profileEdit')}>
                <span className="choice-text">{state.profile.name || t('profile')}</span>
                {state.profile.blanks > 0 && (
                  <span className="choice-note">{t('profileBlanks', { n: state.profile.blanks })}</span>
                )}
                <ChevronRight size={14} className="link-arrow" />
              </button>
            </section>
          )}
          {state.duplicateHint && <div className="hint">{t('duplicate')}</div>}

          {main}
          {!busy && !ending && <Checklist items={state.checklist} t={t} />}
          {flash && <div className="hint">{flash}</div>}
        </div>
      </div>
      {editing && <ProfileSheet t={t} dark={dark} onClose={() => setEditing(false)} onSaved={apply} />}
      {settingsOpen && <SettingsFrame t={t} dark={dark} onClose={closeSettings} />}
    </>
  );
}
