import {
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Ellipsis,
  Eye,
  FileText,
  Minus,
  X,
} from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { parseIsoDate, toIsoDate } from '@domain/dates';
import { browser } from 'wxt/browser';
import type { PetMood } from '../../../../src/ui/pet/engine';
import { Pet, PetDots } from '../../../../src/ui/pet/Pet';
import { adapterFor } from '../../content/adapters';
import { isDone, toBackground, type CardResume, type CardState, type ChecklistItem } from '../../messages';
import type { Signal } from '../../match/scan';
import { failed, waitingOnOwner, working } from '../../pet';
import { DEFAULT_SETTINGS, getSettings, outboxLanguageItem } from '../../storage';
import { resolveLanguage, translator, type MessageKey, type Translate } from '../i18n';
import { Framed } from './Framed';
import { ProfileSheet } from './ProfileSheet';
import { pageIsDark } from './scheme';
import { SettingsFrame } from './SettingsFrame';
import { Track } from './Track';

/** How long after a page with nothing for the card it is looked at again, before the card goes. */
const SETTLE_MS = 1500;

/** What the owner does about a field the fill left open, in a word. */
const KINDS: Partial<Record<ChecklistItem['status'], MessageKey>> = {
  confirm: 'tag.confirm',
  draft: 'tag.draft',
  missing: 'tag.missing',
};

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
 * they close once another is chosen. With `peek`, a line ends in a button that shows what it stands for without
 * choosing it.
 */
function Choices({
  label,
  value,
  choices,
  onChoose,
  fold = false,
  peek,
  held = false,
}: {
  label: string;
  value: string | null;
  choices: Choice[];
  onChoose: (id: string) => void;
  fold?: boolean;
  /** The button at a line's end: its tip, its name for that line, and what it does, told where it was pressed. */
  peek?: { tip: string; name: (choice: Choice) => string; run: (choice: Choice, at: HTMLElement) => void };
  /** Something a line's button opened is up over the card: the lines wait as they were left. */
  held?: boolean;
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
    // The arrows move the choice from a line, not from the button at its end.
    if (!step || free.length === 0 || !(event.target as HTMLElement).dataset.key) return;
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
        if (!held && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Track
        className={`lines${peek ? ' peeks' : ''}`}
        current={value}
        role="radiogroup"
        aria-label={label}
        onKeyDown={move}
      >
        {choices.map((choice, at) => {
          const chosen = choice.id === value;
          const away = shut && !chosen;
          // A line and its button share a row: the button lies over the line's end.
          const row = peek ? { gridRow: at + 1 } : undefined;
          return (
            <Fragment key={choice.id}>
              <button
                data-key={choice.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                aria-hidden={away ? true : undefined}
                disabled={choice.disabled}
                tabIndex={choice.id === stop ? 0 : -1}
                className="choice"
                style={row}
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
                {/* The arrow's place stays free on the other lines, so the buttons stand in one column. */}
                {folds &&
                  (chosen ? (
                    <ChevronDown size={14} className={`choice-fold${open ? ' up' : ''}`} />
                  ) : (
                    peek && <span className="choice-fold" />
                  ))}
              </button>
              {peek && (
                <button
                  type="button"
                  className="icon-button peek"
                  style={row}
                  aria-label={peek.name(choice)}
                  aria-hidden={away ? true : undefined}
                  tabIndex={away ? -1 : 0}
                  title={peek.tip}
                  onClick={(event) => peek.run(choice, event.currentTarget)}
                >
                  <Eye size={14} />
                </button>
              )}
            </Fragment>
          );
        })}
      </Track>
    </div>
  );
}

/** How long ago a day was: today, yesterday, so many days ago. */
function ago(day: string, t: Translate): string {
  const today = parseIsoDate(toIsoDate(new Date())).getTime();
  // Rounded: a day the clocks change on isn't 24 hours long.
  const days = Math.max(0, Math.round((today - parseIsoDate(day).getTime()) / 86_400_000));
  return days === 0 ? t('ago.today') : days === 1 ? t('ago.yesterday') : t('ago.days', { n: days });
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
  if (state.error === 'profile' || (!state.profile && (state.hasForm || !state.jobPage)))
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

/** Where the card is: up, put aside as a tab at the window's edge, or closed until the page moves on. */
type View = 'open' | 'aside' | 'closed';

export function Card({ startOpen }: { startOpen: boolean }) {
  const [state, setState] = useState<CardState | null>(null);
  const [view, setView] = useState<View>(startOpen ? 'open' : 'closed');
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
  // A resume looked at before it's sent, in a window of its own; and the button that asked for the look.
  const [previewing, setPreviewing] = useState<CardResume | null>(null);
  const peeked = useRef<HTMLElement>(null);

  // A request that failed in the service worker answers nothing: the card keeps what it shows.
  const apply = useCallback((next: CardState | undefined) => {
    if (next) setState(next);
  }, []);

  // A second look at a page that came up with nothing for the card, before the card goes.
  const settling = useRef<ReturnType<typeof setTimeout>>(undefined);
  // `moved`: the page gave way to another without loading one, which is why the card reads it again. `again`: the
  // second look.
  const refresh = useCallback(function read(moved = false, again = false) {
    clearTimeout(settling.current);
    toBackground('card:state', { refresh: true, moved })
      .then((next) => {
        if (!next) return;
        setState(next);
        // A page may have drawn its theme, or moved to another one, since the card last looked.
        setDark(pageIsDark());
        // Open where there's something to do: an application, whether or not this page of it has a form; a posting
        // on an applicant-tracking site or LinkedIn (its match check, before applying); the confirmation page with
        // its Undo. Elsewhere the detect script opens the card for a form with a resume upload. Put aside, it stays
        // there: its tab is in sight. A page that is no job's gets the card only when the owner asks for it.
        const show =
          (next.jobPage &&
            next.ats !== 'generic' &&
            (next.hasForm || next.applying || Boolean(next.posting?.title))) ||
          (next.logged && !next.logged.undone);
        if (show) setView((now) => (now === 'closed' ? 'open' : now));
        // And gone where the page it came up for gave way, in place, to one with nothing of that: a board's list
        // of jobs after a posting, a candidate's own pages. Once a second look says so too: the next posting can
        // be on its way still where the address has moved already (LinkedIn's list of jobs, with one beside it).
        else if (moved && next.ats !== 'generic') {
          if (again) setView('closed');
          else settling.current = setTimeout(() => read(true, true), SETTLE_MS);
        }
      })
      .catch(() => undefined);
  }, []);

  const fill = useCallback(() => {
    setView('open');
    toBackground('card:fill', {})
      .then(apply)
      .catch(() => undefined);
  }, [apply]);

  const readSettings = useCallback(
    () =>
      void Promise.all([getSettings(), outboxLanguageItem.getValue()]).then(([settings, outbox]) => {
        setT(() => translator(resolveLanguage(settings.language, outbox)));
        setOutboxUrl(settings.outboxUrl);
      }),
    [],
  );

  useEffect(() => {
    readSettings();
    refresh();
    const settled = settling;
    const listener = (
      message: { type?: string; state?: CardState; checklist?: ChecklistItem[]; asked?: boolean },
      _sender: unknown,
      // Answering tells the service worker there's a card here.
      sendResponse: (reply: boolean) => void,
    ) => {
      if (message.type === 'card:update' && message.state) {
        setState(message.state);
        if (message.state.logged && !message.state.logged.undone) {
          setView('open');
          setLoggedHere(true);
        }
      }
      // The owner filled in or emptied a field by hand: the list follows the page, the rest of the card stands.
      if (message.type === 'card:checklist' && message.checklist) {
        const { checklist } = message;
        setState((current) => current && { ...current, checklist });
      }
      if (message.type === 'card:open') {
        // A form showing opens a closed card; one put aside waits for the owner to ask for it.
        setView((now) => (now === 'aside' && !message.asked ? now : 'open'));
        refresh();
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
        refresh(true);
      }
    }, 1000);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
      clearInterval(timer);
      clearTimeout(settled.current);
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

  // The pet in the header is at work while the extension is, and hops when the work ends with nothing left to fill.
  const atWork = state !== null && working(state);
  const [wasAtWork, setWasAtWork] = useState(false);
  const [cheering, setCheering] = useState(false);
  if (atWork !== wasAtWork) {
    setWasAtWork(atWork);
    if (!atWork && state !== null && state.checklist.length > 0 && !waitingOnOwner(state)) setCheering(true);
  }
  useEffect(() => {
    if (!cheering) return undefined;
    const timer = setTimeout(() => setCheering(false), 2000);
    return () => clearTimeout(timer);
  }, [cheering]);
  // Leaned out over, the pet on the tab of a card put aside gives a little.
  const [tabPokes, setTabPokes] = useState(0);

  // Put aside or brought back by hand, the keyboard goes along: to the tab, and back to the button it was put
  // aside with.
  const tabButton = useRef<HTMLButtonElement>(null);
  const asideButton = useRef<HTMLButtonElement>(null);
  const byHand = useRef(false);
  // A log, a save or an undo on its way: a second press (a double click) waits for it instead of sending another.
  const pressing = useRef(false);
  useEffect(() => {
    if (!byHand.current) return;
    byHand.current = false;
    (view === 'aside' ? tabButton : asideButton).current?.focus({ preventScroll: true });
  }, [view]);

  // Closed, the card is gone until the page changes or the toolbar button is pressed; no pill waits in the corner.
  if (!state || view === 'closed') return null;

  // An application under way, on whichever of its pages: one with a form to fill, or one with nothing to fill just
  // now (a step still on its way, the review before it's sent). The card is the application's on all of them.
  const applying = state.hasForm || state.applying;

  const press = (type: 'card:log' | 'card:save' | 'card:undo') => {
    if (pressing.current) return;
    pressing.current = true;
    void toBackground(type, {})
      .then((next) => {
        apply(next);
        if (type === 'card:log' && next?.logged) setLoggedHere(true);
      })
      .catch(() => undefined)
      .finally(() => {
        pressing.current = false;
      });
  };
  const log = () => press('card:log');
  const save = () => press('card:save');
  const undo = () => press('card:undo');
  const close = (
    <button
      className="icon-button"
      onClick={() => setView('closed')}
      aria-label={t('close')}
      title={t('close')}
    >
      <X size={14} />
    </button>
  );
  const posting = [state.posting?.company, state.posting?.title].filter(Boolean).join(' · ');
  const aside = view === 'aside';
  const frame = `card glass${dark ? ' dark' : ''}${aside ? ' aside' : ''}`;
  const move = (next: View) => {
    byHand.current = true;
    setView(next);
  };
  // Put aside, the card is out of the page's way, as it was left, and Outbox's mark waits at the window's edge:
  // pressed, it brings the card back. Whatever the card shows, the tab goes with it.
  const tab = (
    <button
      ref={tabButton}
      className={`tab glass${dark ? ' dark' : ''}${aside ? ' on' : ''}`}
      onClick={() => move('open')}
      onPointerEnter={() => setTabPokes((n) => n + 1)}
      aria-label={t('back')}
      title={t('back')}
    >
      <Pet size={30} mood="peek" poke={tabPokes} />
    </button>
  );
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
  if (state.logged && (loggedHere || !applying)) {
    const { undone } = state.logged;
    return (
      <>
        <div className={frame} role="dialog" aria-label="Outbox Autofill">
          <div className="done">
            <Pet size={30} className="done-pet" mood={undone ? 'idle' : 'happy'} arrive />
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
        {tab}
      </>
    );
  }

  // Saved for later from a posting: Undo, as after a log. Once the owner applies to it, the card is the
  // application's.
  if (state.saved && !applying) {
    const { undone } = state.saved;
    return (
      <>
        <div className={frame} role="dialog" aria-label="Outbox Autofill">
          <div className="done">
            <Pet size={30} className="done-pet" mood={undone ? 'idle' : 'happy'} arrive />
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
        {tab}
      </>
    );
  }

  const select = (change: { accountId?: string | null; resumeId?: string | null }) =>
    void toBackground('card:select', change)
      .then(apply)
      .catch(() => undefined);
  const closePreview = () => {
    // The keyboard goes back to the button that asked: the resumes, dropped open or not, are as they were left.
    peeked.current?.focus({ preventScroll: true });
    setPreviewing(null);
  };
  const drafting = state.phase === 'drafting';
  const linkedin = state.ats === 'linkedin';
  // Once logged, the card offers it again for another account that hasn't applied yet: another account applying to
  // the same posting from this tab.
  const chosen = state.accounts.find((account) => account.id === state.accountId);
  const another = chosen !== undefined && chosen.id !== state.logged?.accountId && chosen.appliedAt === null;
  const canLog =
    (state.hasForm || linkedin || state.posting !== null) &&
    (!state.logged || state.logged.undone || another);

  const years = state.match?.h1b?.years ?? [];
  const signalText = (signal: Signal) =>
    t(`signal.${signal.code}`, {
      n: signal.evidence,
      from: years[0] ?? '',
      to: years[years.length - 1] ?? '',
    });
  // Asked for on a page that is no job's (the owner's mail, a search, Outbox itself), the card is the extension's
  // own, not that page's: the resumes, the profile, the way to Outbox. It has no job to check a match for, and
  // what it could still do with the page, if the page is a job after all, waits in the menu.
  const home = !state.jobPage;
  const match = home ? null : state.match;
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

  // On a posting no one is applying to yet, saving and logging are buttons of their own (below). LinkedIn keeps
  // its log button for every posting, applied to or not: its Easy Apply happens right there.
  const postingPage =
    !home && !applying && Boolean(state.posting?.company) && (linkedin || state.tracked !== 'applied');
  const menu = [
    ...(canLog && !linkedin && !postingPage ? [{ label: t('log'), run: log }] : []),
    ...(home && state.otherForm
      ? [
          {
            label: t('home.asForm'),
            run: () =>
              void toBackground('card:asForm', {})
                .then(apply)
                .catch(() => undefined),
          },
        ]
      : []),
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

  const petMood: PetMood =
    state.phase === 'reading'
      ? 'read'
      : state.phase === 'filling' || state.phase === 'drafting'
        ? 'work'
        : failed(state)
          ? 'oops'
          : cheering
            ? 'happy'
            : 'idle';

  let main: ReactNode = null;
  if (state.hasForm) {
    main =
      busy || ending ? (
        <Progress
          stage={state.phase === 'reading' ? 'reading' : busy ? 'filling' : 'done'}
          label={state.phase === 'reading' ? t('reading') : t('filling')}
        />
      ) : state.checklist.length === 0 ? (
        <button className="primary" disabled={!state.profile} onClick={fill}>
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
                <PetDots size={16} />
                {t('drafting')}
              </span>
            ) : (
              <button className="ghost" onClick={fill}>
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
    // A posting without a form yet: say it was applied to, or save it for later. Saying so comes first and stands
    // out: it's what the owner mostly presses there, and on LinkedIn applying happens right on the page (Easy Apply).
    const saveButton =
      state.tracked !== null ? null : (
        <button className="secondary" onClick={save}>
          <Bookmark size={14} />
          {t('save')}
        </button>
      );
    const logButton = canLog && (
      <button className="primary" onClick={log}>
        {linkedin ? t('log') : t('markApplied')}
      </button>
    );
    main = (
      <>
        {state.tracked === 'saved' && <div className="hint">{t('alreadySaved')}</div>}
        <div className="actions">
          {logButton}
          {saveButton}
        </div>
      </>
    );
  } else if (state.applying && !state.sends) {
    // A page of the application with nothing to fill: a step on its way, more often than not. The button waits
    // where it will be pressed.
    main = (
      <button className="primary" disabled>
        {t('fill')}
      </button>
    );
  } else if (state.applying && canLog) {
    // Its last page, with nothing left to fill: sending it is the owner's, and the log follows by itself.
    main = <div className="hint">{t('lastStep')}</div>;
  }

  // An application is worked through beside the page, in a panel the window's height, which stays as its steps
  // come and go; a posting or a log needs only a card. The profile's window, when open, is the card's sibling:
  // over the page, not inside the panel.
  return (
    <>
      <div className={`${frame}${applying ? ' panel' : ''}`} role="dialog" aria-label="Outbox Autofill">
        <header className="head">
          {/* Fields the fill left empty: it looks down at the list, with a dot. */}
          <Pet
            size={26}
            className="brand-mark"
            mood={petMood}
            look={waitingOnOwner(state) ? 'down' : null}
            badge={waitingOnOwner(state)}
          />
          {/* The page already says whose posting this is: the company waits in the hover, with the match check. */}
          <div
            className="head-text"
            title={
              [
                ...(home ? [] : [posting]),
                ...(match ? [t(`match.${match.level}`), ...match.signals.map(signalText)] : []),
              ]
                .filter(Boolean)
                .join('\n') || undefined
            }
          >
            <div className="title">
              {match && <span className={`dot ${match.level}`} />}
              <span>{home ? 'Outbox Autofill' : (state.posting?.title ?? t('outbox'))}</span>
            </div>
            {reasons.length > 0 && (
              <div className={`reasons ${match!.level}`}>{reasons.map(signalText).join(' · ')}</div>
            )}
          </div>
          <Menu items={menu} label={t('more')} />
          <button
            ref={asideButton}
            className="icon-button"
            onClick={() => move('aside')}
            aria-label={t('aside')}
            title={t('aside')}
          >
            <Minus size={14} />
          </button>
          {close}
        </header>

        <div className="body">
          {noticeLine}
          {home && <div className="hint">{t('home.none')}</div>}

          {/* Applied to before: said first and in color, with who did and when. A form is as quick to fill a second
            time as the first. */}
          {state.tracked === 'applied' && (
            <div className="applied" role="status">
              <CircleAlert size={16} className="applied-icon" />
              <div className="applied-text">
                <div className="applied-title">{t('appliedBefore')}</div>
                {state.accounts.map(
                  (item) =>
                    item.appliedAt && (
                      <div key={item.id} className="applied-by">
                        <span className="dot" style={{ background: `var(--acc-${item.color})` }} />
                        <span className="applied-who">{item.email}</span>
                        <span className="applied-when">{ago(item.appliedAt, t)}</span>
                      </div>
                    ),
                )}
                {state.duplicateHint && <div className="applied-more">{t('duplicate')}</div>}
              </div>
            </div>
          )}

          {/* Who applies and with which resume, each choice on its own line: an address or a file name cut short
            tells nothing. */}
          {(applying || (linkedin && !home)) && state.accounts.length > 0 && (
            <section className="section">
              <h2 className="label">{t('account')}</h2>
              <Choices
                label={t('account')}
                value={state.accountId}
                choices={state.accounts.map((item) => ({
                  id: item.id,
                  icon: <span className="dot" style={{ background: `var(--acc-${item.color})` }} />,
                  text: item.email,
                  note: item.appliedAt ? t('applied') : undefined,
                  disabled: Boolean(item.appliedAt),
                }))}
                onChoose={(accountId) => select({ accountId })}
              />
            </section>
          )}
          {(applying || home) && (
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
                  // Which version is this one? A look at its pages, without choosing it.
                  peek={{
                    tip: t('preview'),
                    name: (choice) => t('previewOf', { name: choice.text }),
                    run: (choice, at) => {
                      peeked.current = at;
                      setPreviewing({ id: choice.id, label: choice.text });
                    },
                  }}
                  held={previewing !== null}
                />
              ) : (
                <div className="choices none">{t('noResume')}</div>
              )}
            </section>
          )}
          {/* What the form is filled from, a press away from being edited right here. */}
          {(applying || home) && state.profile && (
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
          {/* Outbox itself is a site of its own: this one row leaves the page, in a tab beside it. */}
          {home && (
            <section className="section">
              <h2 className="label">{t('outbox')}</h2>
              <a className="choices link" href={outboxUrl} target="_blank" rel="noreferrer">
                <span className="choice-text">{t('home.open')}</span>
                <ArrowUpRight size={14} className="link-arrow" />
              </a>
            </section>
          )}
          {main}
          {!busy && !ending && <Checklist items={state.checklist} t={t} />}
          {flash && <div className="hint">{flash}</div>}
        </div>
      </div>
      {tab}
      {editing && <ProfileSheet t={t} dark={dark} onClose={() => setEditing(false)} onSaved={apply} />}
      {settingsOpen && <SettingsFrame t={t} dark={dark} onClose={closeSettings} />}
      {previewing && (
        <Framed
          name="preview"
          page="/preview.html"
          title={t('previewOf', { name: previewing.label })}
          dark={dark}
          tall
          ask={() => toBackground('preview:open', { resumeId: previewing.id })}
          onClose={closePreview}
          onStuck={() => setFlash(t('previewStuck'))}
        />
      )}
    </>
  );
}
