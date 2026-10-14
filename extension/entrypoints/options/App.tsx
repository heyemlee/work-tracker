import { Check, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { WxtStorageItem } from 'wxt/utils/storage';
import { BrandMark } from '../../../src/ui/BrandMark';
import { checkKey } from '../../src/background/ai';
import { toBackground, type SettingsStatus } from '../../src/messages';
import type { Ats } from '../../src/model';
import { missingItems } from '../../src/profile/profile';
import {
  ANTHROPIC_API,
  anthropicAddress,
  openaiAddress,
  apiKeyItem,
  finalsItem,
  memoryItem,
  MODELS,
  OPENAI_MODELS,
  openaiKeyItem,
  pendingLogsItem,
  profileItem,
  profileSourceItem,
  settingsItem,
  snapshotsItem,
  usageItem,
  withDefaults,
  type Effort,
  type FormSnapshot,
  type Settings,
} from '../../src/storage';
import { Choice, Count, Field, Grid, Heading, Note, Toggle, Toggles } from '../../src/ui/card/fields';
import { Track } from '../../src/ui/card/Track';
import { resolveLanguage } from '../../src/ui/i18n';
import { keyVerdict, type Verdict } from './keyVerdict';
import { strings, type Strings } from './strings';

const SECTIONS = ['connection', 'ai', 'reports', 'memory', 'general'] as const;
type Section = (typeof SECTIONS)[number];

interface Props {
  s: Strings;
  settings: Settings;
}

/** A storage item's value, kept current as it changes (in this page or another). */
function useItem<T>(item: WxtStorageItem<T, Record<string, unknown>>): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    void item.getValue().then(setValue);
    return item.watch((next) => setValue(next));
  }, [item]);
  return value;
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** What was written last, and whether the browser kept it: the field it belongs to says so. */
interface Mark {
  name: string;
  kept: boolean;
  at: number;
}

interface Saving {
  mark: Mark | null;
  /** Says at the field called `name` how a write to the browser's storage ended; resolves to whether it held. */
  wrote: (name: string, write: Promise<unknown>) => Promise<boolean>;
}

const SavingContext = createContext<Saving>({ mark: null, wrote: async () => true });

/** How long a field says it was saved, in milliseconds. */
const SAID_FOR = 2500;

/** Changes the settings, and has the field of what changed say so. */
function useSave(settings: Settings): (change: Partial<Settings>) => void {
  const { wrote } = useContext(SavingContext);
  return (change) =>
    void wrote(Object.keys(change)[0] ?? '', settingsItem.setValue({ ...settings, ...change }));
}

/**
 * At the end of a field's label: how to keep what's typed there while it isn't kept, then, for a moment, that it
 * is. Nothing here has a Save button of its own to tell it by.
 */
function Saved({
  s,
  name,
  typing = false,
  held = false,
}: {
  s: Strings;
  name: string;
  /** Something is typed in the field that isn't kept yet. */
  typing?: boolean;
  /** What's kept can't be read in the field (a key): that it's there is said the whole time. */
  held?: boolean;
}) {
  const { mark } = useContext(SavingContext);
  const mine = mark?.name === name ? mark : null;
  if (mine && !mine.kept)
    return (
      <span className="saved bad" role="status">
        {s('notSaved')}
      </span>
    );
  if (typing) return <span className="saved">{s('enterSaves')}</span>;
  if (mine)
    return (
      <span className="saved fresh" role="status">
        <Check size={11} strokeWidth={3.5} />
        {s('saved')}
      </span>
    );
  return held ? <span className="saved">{s('saved')}</span> : null;
}

const today = () => new Date().toISOString().slice(0, 10);
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** A name, what it's set to, and what to do about it. */
function Row({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <div className="row-value">{children}</div>
      {action}
    </div>
  );
}

/**
 * A text setting, saved when the field is left or Enter is pressed: an address half typed is no address. Until
 * then its label says how to save it, and afterwards that it's saved. Emptied, it goes back to what's kept.
 */
function Kept({
  s,
  label,
  name,
  value,
  onSave,
  clean = (text) => text,
  placeholder,
  wide,
}: {
  s: Strings;
  label: string;
  /** The setting it holds, as `Settings` names it. */
  name: keyof Settings;
  value: string;
  onSave: (value: string) => void;
  /** What's typed, as it's kept. */
  clean?: (text: string) => string;
  placeholder?: string;
  wide?: boolean;
}) {
  const [text, setText] = useState(value);
  // The setting changed elsewhere (another tab, a default restored), or was saved in another form than typed.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  const typed = clean(text.trim());
  const commit = () => {
    if (typed && typed !== value) onSave(typed);
    else setText(value);
  };
  return (
    <Field
      label={label}
      wide={wide}
      note={<Saved s={s} name={name} typing={typed !== '' && typed !== value} />}
    >
      <input
        className="input"
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </Field>
  );
}

/** One of a list that can be taken off it: a report, a remembered answer. */
function Record({
  title,
  sub,
  remove,
  onRemove,
}: {
  title: string;
  sub: string;
  remove: string;
  onRemove: () => void;
}) {
  return (
    <div className="record">
      <div className="record-text">
        <div className="record-title" title={title}>
          {title}
        </div>
        <div className="record-sub" title={sub}>
          {sub}
        </div>
      </div>
      <button className="icon-button" aria-label={remove} title={remove} onClick={onRemove}>
        <X size={14} />
      </button>
    </div>
  );
}

const EFFORTS: Effort[] = ['auto', 'low', 'medium', 'high'];

const DOWN: SettingsStatus = { outbox: { state: 'unreachable', detail: '' }, resumes: null };

/** Outbox, and what this browser copies from it: the profile and the resumes. Asked when the section opens. */
function Connection({ s, settings }: Props) {
  const save = useSave(settings);
  const profile = useItem(profileItem);
  const source = useItem(profileSourceItem);
  const pending = useItem(pendingLogsItem) ?? [];
  // Null while Outbox is being asked.
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const ask = useCallback(
    () =>
      void toBackground('settings:status', {})
        .then((next) => setStatus(next ?? DOWN))
        .catch(() => setStatus(DOWN)),
    [],
  );
  useEffect(ask, [ask]);

  const outbox = status?.outbox;
  const onOutbox = (label: string) => (
    <a className="ghost" href={settings.outboxUrl} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
  const missing = profile ? missingItems(profile).length : 0;
  return (
    <>
      <div className="rows">
        <Row
          label="Outbox"
          action={
            outbox?.state === 'signedOut' ? (
              onOutbox(s('signIn'))
            ) : outbox?.state === 'unreachable' ? (
              <button
                className="ghost"
                onClick={() => {
                  setStatus(null);
                  ask();
                }}
              >
                {s('retry')}
              </button>
            ) : undefined
          }
        >
          {!outbox && <span className="dim">{s('checking')}</span>}
          {outbox?.state === 'connected' &&
            s(outbox.accounts === 1 ? 'connectedOne' : 'connected', { n: outbox.accounts })}
          {outbox?.state === 'signedOut' && <span className="warn">{s('signedOut')}</span>}
          {outbox?.state === 'unreachable' && (
            <span className="bad" title={outbox.detail}>
              {s('unreachable', { detail: outbox.detail })}
            </span>
          )}
        </Row>
        {profile !== undefined && (
          <Row label={s('profile')}>
            {profile ? (
              <>
                {profile.name.first} {profile.name.last}
                {missing > 0 && <span className="warn"> · {s('missing', { n: missing })}</span>}
                {/* Offline, the copy here is what fills: say how old it is. */}
                {source && outbox && outbox.state !== 'connected' && (
                  <span className="dim"> · {s('copyFrom', { when: when(source.syncedAt) })}</span>
                )}
              </>
            ) : (
              <span className="warn">{s('noProfile')}</span>
            )}
          </Row>
        )}
        {status?.resumes && (
          <Row label={s('resumes')} action={onOutbox(s('manage'))}>
            {status.resumes.length ? (
              <span title={status.resumes.join('\n')}>{status.resumes.join(', ')}</span>
            ) : (
              <span className="warn">{s('noResumes')}</span>
            )}
          </Row>
        )}
        {pending.length > 0 && (
          <Row label={s('queue')}>
            <span className="warn">{s('queued', { n: pending.length })}</span>
          </Row>
        )}
      </div>
      <Grid>
        <Kept
          s={s}
          label={s('outboxUrl')}
          name="outboxUrl"
          wide
          value={settings.outboxUrl}
          clean={(address) => address.replace(/\/$/, '')}
          onSave={(outboxUrl) => save({ outboxUrl })}
        />
      </Grid>
    </>
  );
}

/**
 * The provider's key. Once typed it's never shown again, so its label says the whole time that one is saved. A key
 * typed in is saved when the field is left, as any setting is; Enter and the button save it and have it tried.
 */
function Key({
  s,
  settings,
  checking,
  onKept,
  onCheck,
}: Props & {
  checking: boolean;
  /** Another key is kept than the one a check was of. */
  onKept: () => void;
  /** Try the kept key, once the write that's handed over is through. */
  onCheck: (written: Promise<unknown>) => void;
}) {
  const openai = settings.provider === 'openai';
  const item = openai ? openaiKeyItem : apiKeyItem;
  const stored = useItem(item) ?? '';
  const { wrote } = useContext(SavingContext);
  const [draft, setDraft] = useState('');
  // The key typed last, from the moment it's handed over until the browser's own copy says the same (or another,
  // changed elsewhere): the field has no moment in between when no key seems kept.
  const [fresh, setFresh] = useState<string | null>(null);
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    setFresh(null);
  }
  const key = fresh ?? stored;
  // The write of a key under way, or the last one: a check waits for it, so that it tries the key just typed.
  const writing = useRef<Promise<unknown>>(Promise.resolve());

  const keep = (): Promise<unknown> => {
    const next = draft.trim();
    setDraft('');
    if (!next) return writing.current;
    setFresh(next);
    onKept();
    writing.current = wrote(item.key, item.setValue(next)).then((kept) => {
      if (!kept) setFresh(null);
    });
    return writing.current;
  };
  return (
    <Field
      label={s('key')}
      // Each provider's key is a thing kept of its own: one just saved says nothing of the other.
      note={<Saved s={s} name={item.key} typing={draft.trim() !== ''} held={key !== ''} />}
    >
      <span className="with-action">
        <input
          className={`input${key ? ' held' : ''}`}
          type="password"
          autoComplete="off"
          placeholder={key ? `••••${key.slice(-4)}` : openai ? 'sk-…' : 'sk-ant-…'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void keep()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCheck(keep());
          }}
        />
        <button
          type="button"
          className="secondary"
          disabled={checking || (!draft.trim() && !key)}
          onClick={() => onCheck(keep())}
        >
          {draft.trim() ? s('save') : s('check')}
        </button>
      </span>
    </Field>
  );
}

function Ai({ s, settings }: Props) {
  const save = useSave(settings);
  const openai = settings.provider === 'openai';
  const usage = useItem(usageItem) ?? [];
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const month = new Date().toLocaleDateString('en-CA').slice(0, 7);
  const thisMonth = usage.filter((day) => day.day.startsWith(month));
  const cost = thisMonth.reduce((sum, day) => sum + day.cost, 0);
  const tokens = thisMonth.reduce((sum, day) => sum + day.inputTokens + day.outputTokens, 0);
  // Which check the line under the fields is waiting for. One asked before the key, the provider, the address or
  // the model changed answers for a request that's no longer the one in use: it's dropped.
  const asked = useRef(0);
  const forget = () => {
    asked.current += 1;
    setVerdict(null);
  };
  const change = (to: Partial<Settings>) => {
    forget();
    save(to);
  };
  // The check goes out as any request would: it also tells whether the endpoint takes the effort chosen here.
  const check = async (written: Promise<unknown>) => {
    const mine = ++asked.current;
    setVerdict({ tone: 'wait', text: s('checking') });
    await written;
    const found = await checkKey();
    if (mine !== asked.current) return;
    setVerdict(keyVerdict(found, openai && settings.openaiEffort !== 'auto', s));
  };
  // The models the owner settled on, and whatever else the setting already holds.
  const models = OPENAI_MODELS.includes(settings.openaiModel)
    ? OPENAI_MODELS
    : [...OPENAI_MODELS, settings.openaiModel].filter(Boolean);
  return (
    <>
      <Toggles>
        <Toggle
          label={s('aiEnabled')}
          checked={settings.aiEnabled}
          onChange={(aiEnabled) => save({ aiEnabled })}
        />
      </Toggles>
      {!settings.aiEnabled ? (
        <Note>{s('aiOff')}</Note>
      ) : (
        <>
          <Grid>
            <Choice
              label={s('provider')}
              note={<Saved s={s} name="provider" />}
              value={settings.provider}
              options={[
                { value: 'openai', label: s('providerOpenai') },
                { value: 'anthropic', label: s('providerAnthropic') },
              ]}
              onChange={(provider) => change({ provider })}
            />
            {/* Each provider has an address of its own, and a key: one half typed for the one isn't the other's. */}
            {openai ? (
              <Kept
                key="openaiBaseUrl"
                s={s}
                label={s('baseUrl')}
                name="openaiBaseUrl"
                value={settings.openaiBaseUrl}
                placeholder="https://api.openai.com/v1"
                clean={openaiAddress}
                onSave={(openaiBaseUrl) => change({ openaiBaseUrl })}
              />
            ) : (
              // Anthropic's own API unless another address is typed; emptied, it's Anthropic's own again.
              <Kept
                key="anthropicBaseUrl"
                s={s}
                label={s('baseUrl')}
                name="anthropicBaseUrl"
                value={settings.anthropicBaseUrl}
                placeholder={ANTHROPIC_API}
                clean={anthropicAddress}
                onSave={(anthropicBaseUrl) => change({ anthropicBaseUrl })}
              />
            )}
            <Key
              key={settings.provider}
              s={s}
              settings={settings}
              checking={verdict?.tone === 'wait'}
              onKept={forget}
              onCheck={(written) => void check(written)}
            />
            {openai ? (
              <Choice
                label={s('model')}
                note={<Saved s={s} name="openaiModel" />}
                value={settings.openaiModel}
                options={models.map((model) => ({ value: model, label: model }))}
                onChange={(openaiModel) => change({ openaiModel })}
              />
            ) : (
              <Choice
                label={s('model')}
                note={<Saved s={s} name="model" />}
                value={settings.model}
                options={MODELS.map((model) => ({ value: model.id, label: model.name }))}
                onChange={(model) => change({ model })}
              />
            )}
            {openai && (
              <Choice
                label={s('effort')}
                note={<Saved s={s} name="openaiEffort" />}
                value={settings.openaiEffort}
                options={EFFORTS.map((effort) => ({ value: effort, label: s(`effort.${effort}`) }))}
                onChange={(openaiEffort) => change({ openaiEffort })}
              />
            )}
          </Grid>
          {openai && <Note>{s('effortHelp')}</Note>}
          {verdict && (
            <p className={`sheet-note ${verdict.tone}`} role="status">
              {verdict.text}
            </p>
          )}
          {/* What Anthropic's own API costs is known here; a proxy's prices aren't, nor an OpenAI-compatible
              endpoint's: their tokens, not their cost. */}
          <Note>
            {openai || anthropicAddress(settings.anthropicBaseUrl) !== ANTHROPIC_API
              ? s('usageTokens', { tokens: tokens.toLocaleString() })
              : s('usageCost', { cost: cost.toFixed(2) })}
          </Note>
        </>
      )}
    </>
  );
}

const ATS_NAMES: Record<Ats, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  gem: 'Gem',
  linkedin: 'LinkedIn',
  generic: '',
};

/** Whose form a report is of: the posting where it was kept, else the page's address. */
function reportTitle(shot: FormSnapshot): string {
  const posting = [shot.company, shot.title].filter(Boolean).join(' · ');
  if (posting) return posting;
  try {
    const { host, pathname } = new URL(shot.url);
    return `${host}${pathname === '/' ? '' : pathname}`;
  } catch {
    return shot.url;
  }
}

/** The pages marked "This page didn't fill right": the list of what's still to be fixed. */
function Reports({ s }: Props) {
  const snapshots = useItem(snapshotsItem) ?? [];
  return (
    <>
      <Note>{s('reportsHelp')}</Note>
      {snapshots.length === 0 ? (
        <p className="empty">{s('reportsNone')}</p>
      ) : (
        <div className="records">
          {snapshots.map((shot) => {
            const unfilled = shot.fields.filter((field) => field.status === 'missing').length;
            return (
              <Record
                key={shot.id}
                title={reportTitle(shot)}
                sub={[
                  ATS_NAMES[shot.ats],
                  shot.step,
                  s('fields', { n: shot.fields.length }),
                  unfilled > 0 ? s('unfilled', { n: unfilled }) : '',
                  when(shot.at),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                remove={s('delete')}
                onRemove={() => void snapshotsItem.setValue(snapshots.filter((item) => item.id !== shot.id))}
              />
            );
          })}
        </div>
      )}
      {snapshots.length > 0 && (
        <div className="buttons">
          <button
            className="secondary"
            onClick={() => download(`outbox-autofill-reports-${today()}.json`, snapshots)}
          >
            {s('export')}
          </button>
        </div>
      )}
    </>
  );
}

function Memory({ s }: Props) {
  const memory = useItem(memoryItem) ?? [];
  const shown = (answer: (typeof memory)[number]['answer']) =>
    answer.type === 'text'
      ? answer.text
      : answer.type === 'choice'
        ? (answer.option ?? '')
        : answer.type === 'choices'
          ? answer.texts.join(', ')
          : answer.type === 'check'
            ? String(answer.checked)
            : answer.type;
  return (
    <>
      <Note>{s('memoryHelp')}</Note>
      {memory.length === 0 ? (
        <p className="empty">{s('memoryNone')}</p>
      ) : (
        <div className="records">
          {memory.map((entry) => (
            <Record
              key={entry.key}
              title={entry.label}
              sub={shown(entry.answer)}
              remove={s('delete')}
              onRemove={() => void memoryItem.setValue(memory.filter((item) => item.key !== entry.key))}
            />
          ))}
        </div>
      )}
    </>
  );
}

function General({ s, settings }: Props) {
  const save = useSave(settings);
  // Deleting everything is asked twice, here in the window.
  const [confirming, setConfirming] = useState(false);
  const exportAll = async () =>
    download(`outbox-autofill-${today()}.json`, {
      profile: await profileItem.getValue(),
      settings: await settingsItem.getValue(),
      memory: await memoryItem.getValue(),
      finals: await finalsItem.getValue(),
      snapshots: await snapshotsItem.getValue(),
      usage: await usageItem.getValue(),
    });
  return (
    <>
      <Grid>
        <Choice
          label={s('language')}
          note={<Saved s={s} name="language" />}
          value={settings.language}
          options={[
            { value: 'auto', label: s('auto') },
            { value: 'en', label: 'English' },
            { value: 'zh', label: '简体中文' },
          ]}
          onChange={(language) => save({ language })}
        />
        <Count
          label={s('limit')}
          note={<Saved s={s} name="sameCompanyLimit" />}
          max={20}
          value={settings.sameCompanyLimit}
          // Emptied, it keeps the number it had until another is typed.
          onChange={(limit) => {
            if (limit !== null && limit > 0) save({ sameCompanyLimit: limit });
          }}
        />
      </Grid>
      <Note>{s('limitHelp')}</Note>
      <Heading>{s('data')}</Heading>
      <Note>{s('exportHelp')}</Note>
      <div className="buttons">
        <button className="secondary" onClick={() => void exportAll()}>
          {s('exportAll')}
        </button>
        <button className="secondary danger" disabled={confirming} onClick={() => setConfirming(true)}>
          {s('deleteAll')}
        </button>
      </div>
      {confirming && (
        <div className="notice error" role="alert">
          <span>{s('confirmDelete')}</span>
          <button
            className="notice-action"
            onClick={() =>
              void toBackground('settings:deleteAll', {})
                .catch(() => undefined)
                .then(() => setConfirming(false))
            }
          >
            {s('deleteAll')}
          </button>
          <button className="notice-action" onClick={() => setConfirming(false)}>
            {s('cancel')}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * The settings: sections down the left, the one open to its right, as in the profile's window. Framed, they fill the
 * card's window over a page and close back to it; in a tab of their own they're that window on a plain ground.
 * Everything saves as it's changed, and says so where it was changed.
 */
export function App({ framed, dark }: { framed: boolean; dark: boolean }) {
  const kept = useItem(settingsItem);
  const settings = withDefaults(kept);
  const s = strings(resolveLanguage(settings.language));
  const [section, setSection] = useState<Section>('connection');

  const [mark, setMark] = useState<Mark | null>(null);
  const wrote = useCallback<Saving['wrote']>(async (name, write) => {
    const held = await write.then(
      () => true,
      () => false,
    );
    setMark({ name, kept: held, at: Date.now() });
    return held;
  }, []);
  // That something was saved is said for a moment; that it wasn't, until the next thing is written.
  useEffect(() => {
    if (!mark?.kept) return undefined;
    const timer = setTimeout(() => setMark(null), SAID_FOR);
    return () => clearTimeout(timer);
  }, [mark]);
  const saving = useMemo(() => ({ mark, wrote }), [mark, wrote]);

  const close = useCallback(() => void toBackground('settings:close', {}).catch(() => undefined), []);
  useEffect(() => {
    if (!framed) return undefined;
    // What's typed into a field is kept as the field is left (or at Enter): a window closed with the keyboard still
    // in a field leaves it first, so it's kept, as a press of ✕ does.
    const leave = () => (document.activeElement as HTMLElement | null)?.blur?.();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      leave();
      close();
    };
    // Closed from outside the frame (a press beside the window), the card says so first.
    const onMessage = (event: MessageEvent) => {
      if (event.source === window.parent && (event.data as { type?: string })?.type === 'settings:closing')
        leave();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
    };
  }, [framed, close]);

  // Until the settings are read there's nothing true to show: not their language, not what's switched on.
  if (!kept) return null;

  const pane = (
    <div className={`pane${dark ? ' dark' : ''}`}>
      <header className="sheet-head">
        <BrandMark size={24} />
        <h1>{s('title')}</h1>
        {framed && (
          <button className="icon-button" onClick={close} aria-label={s('close')} title={s('close')}>
            <X size={14} />
          </button>
        )}
      </header>
      <div className="sheet-main">
        <Track className="sheet-nav" current={section} role="tablist" aria-orientation="vertical">
          {SECTIONS.map((name) => (
            <button
              key={name}
              data-key={name}
              role="tab"
              aria-selected={name === section}
              className="sheet-tab"
              onClick={() => setSection(name)}
            >
              {s(`tab.${name}`)}
            </button>
          ))}
        </Track>
        <div className="sheet-fields" role="tabpanel" aria-label={s(`tab.${section}`)}>
          {/* Another address is another Outbox: asked anew. */}
          {section === 'connection' && <Connection key={settings.outboxUrl} s={s} settings={settings} />}
          {section === 'ai' && <Ai s={s} settings={settings} />}
          {section === 'reports' && <Reports s={s} settings={settings} />}
          {section === 'memory' && <Memory s={s} settings={settings} />}
          {section === 'general' && <General s={s} settings={settings} />}
        </div>
      </div>
    </div>
  );
  return (
    <SavingContext.Provider value={saving}>
      {framed ? (
        pane
      ) : (
        <div className={`tab-page${dark ? ' dark' : ''}`}>
          <div className={`sheet glass${dark ? ' dark' : ''}`}>{pane}</div>
        </div>
      )}
    </SavingContext.Provider>
  );
}
