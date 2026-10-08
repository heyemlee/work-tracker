import { X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { WxtStorageItem } from 'wxt/utils/storage';
import { BrandMark } from '../../../src/ui/BrandMark';
import { checkKey } from '../../src/background/ai';
import { toBackground, type SettingsStatus } from '../../src/messages';
import type { Ats } from '../../src/model';
import { missingItems } from '../../src/profile/profile';
import {
  apiKeyItem,
  DEFAULT_SETTINGS,
  finalsItem,
  memoryItem,
  OPENAI_MODELS,
  openaiKeyItem,
  pendingLogsItem,
  profileItem,
  profileSourceItem,
  settingsItem,
  snapshotsItem,
  usageItem,
  type Effort,
  type FormSnapshot,
  type Settings,
} from '../../src/storage';
import { Choice, Count, Field, Grid, Heading, Note, Toggle, Toggles } from '../../src/ui/card/fields';
import { Track } from '../../src/ui/card/Track';
import { resolveLanguage } from '../../src/ui/i18n';
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

const save = (settings: Settings, change: Partial<Settings>) =>
  void settingsItem.setValue({ ...settings, ...change });
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

/** A text setting, saved when the field is left or Enter is pressed: an address half typed is no address. */
function Kept({
  value,
  onSave,
  placeholder,
}: {
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  // The setting changed elsewhere (another tab, a default restored).
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  const commit = () => {
    if (text.trim() !== value) onSave(text.trim());
  };
  return (
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
        <Field label={s('outboxUrl')} wide>
          <Kept
            value={settings.outboxUrl}
            onSave={(address) => {
              const next = address.replace(/\/$/, '');
              if (next) save(settings, { outboxUrl: next });
            }}
          />
        </Field>
      </Grid>
    </>
  );
}

function Ai({ s, settings }: Props) {
  const openai = settings.provider === 'openai';
  const keyItem = openai ? openaiKeyItem : apiKeyItem;
  const key = useItem(keyItem) ?? '';
  const usage = useItem(usageItem) ?? [];
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<{ tone: 'good' | 'warn' | 'bad'; text: string } | null>(null);
  const month = new Date().toLocaleDateString('en-CA').slice(0, 7);
  const thisMonth = usage.filter((day) => day.day.startsWith(month));
  const cost = thisMonth.reduce((sum, day) => sum + day.cost, 0);
  const tokens = thisMonth.reduce((sum, day) => sum + day.inputTokens + day.outputTokens, 0);
  // The check goes out as any request would: it also tells whether the endpoint takes the effort chosen here.
  const verify = () =>
    checkKey().then((check) =>
      setResult(
        !check.ok
          ? { tone: 'bad', text: s('keyBad', { detail: check.error ?? '' }) }
          : check.effortRefused && openai && settings.openaiEffort !== 'auto'
            ? { tone: 'warn', text: s('keyOkNoEffort') }
            : { tone: 'good', text: s('keyOk') },
      ),
    );
  // A key typed in is saved, then tried; with none typed, the saved key is tried.
  const saveKey = async () => {
    if (draft.trim()) {
      await keyItem.setValue(draft.trim());
      setDraft('');
    }
    await verify();
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
          onChange={(aiEnabled) => save(settings, { aiEnabled })}
        />
      </Toggles>
      {!settings.aiEnabled ? (
        <Note>{s('aiOff')}</Note>
      ) : (
        <>
          <Grid>
            <Choice
              label={s('provider')}
              value={settings.provider}
              options={[
                { value: 'openai', label: s('providerOpenai') },
                { value: 'anthropic', label: s('providerAnthropic') },
              ]}
              onChange={(provider) => {
                setResult(null);
                save(settings, { provider });
              }}
            />
            {openai ? (
              <Field label={s('baseUrl')}>
                <Kept
                  value={settings.openaiBaseUrl}
                  placeholder="https://api.openai.com/v1"
                  onSave={(openaiBaseUrl) => save(settings, { openaiBaseUrl })}
                />
              </Field>
            ) : (
              <Choice
                label={s('model')}
                value={settings.model}
                options={[
                  { value: 'claude-opus-5', label: 'Claude Opus 5' },
                  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
                ]}
                onChange={(model) => save(settings, { model })}
              />
            )}
            <Field label={s('key')}>
              <span className="with-action">
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder={key ? `••••${key.slice(-4)}` : openai ? 'sk-…' : 'sk-ant-…'}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveKey();
                  }}
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={!draft.trim() && !key}
                  onClick={() => void saveKey()}
                >
                  {draft.trim() ? s('save') : s('check')}
                </button>
              </span>
            </Field>
            {openai && (
              <Choice
                label={s('model')}
                value={settings.openaiModel}
                options={models.map((model) => ({ value: model, label: model }))}
                onChange={(openaiModel) => {
                  setResult(null);
                  save(settings, { openaiModel });
                }}
              />
            )}
            {openai && (
              <Choice
                label={s('effort')}
                value={settings.openaiEffort}
                options={EFFORTS.map((effort) => ({ value: effort, label: s(`effort.${effort}`) }))}
                onChange={(openaiEffort) => {
                  setResult(null);
                  save(settings, { openaiEffort });
                }}
              />
            )}
          </Grid>
          {openai && <Note>{s('effortHelp')}</Note>}
          {result && (
            <p className={`sheet-note ${result.tone}`} role="status">
              {result.text}
            </p>
          )}
          {/* An OpenAI-compatible endpoint's prices aren't known here: its tokens, not its cost. */}
          <Note>
            {openai
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
          value={settings.language}
          options={[
            { value: 'auto', label: s('auto') },
            { value: 'en', label: 'English' },
            { value: 'zh', label: '简体中文' },
          ]}
          onChange={(language) => save(settings, { language })}
        />
        <Count
          label={s('limit')}
          max={20}
          value={settings.sameCompanyLimit}
          onChange={(limit) => save(settings, { sameCompanyLimit: limit && limit > 0 ? limit : 3 })}
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
 * Everything saves as it's changed.
 */
export function App({ framed, dark }: { framed: boolean; dark: boolean }) {
  const kept = useItem(settingsItem);
  const settings = { ...DEFAULT_SETTINGS, ...(kept ?? {}) };
  const s = strings(resolveLanguage(settings.language));
  const [section, setSection] = useState<Section>('connection');

  const close = useCallback(() => void toBackground('settings:close', {}).catch(() => undefined), []);
  useEffect(() => {
    if (!framed) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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
  if (framed) return pane;
  return (
    <div className={`tab-page${dark ? ' dark' : ''}`}>
      <div className={`sheet glass${dark ? ' dark' : ''}`}>{pane}</div>
    </div>
  );
}
