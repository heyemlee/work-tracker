import type { Snapshot } from '@domain/types';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { WxtStorageItem } from 'wxt/utils/storage';
import { checkKey, listOpenAIModels } from '../../src/background/ai';
import { flushQueue, loadSnapshot, OutboxSignedOut, syncProfile } from '../../src/background/outbox';
import { missingItems } from '../../src/profile/profile';
import { clearResumeCopies } from '../../src/resumes';
import {
  apiKeyItem,
  DEFAULT_SETTINGS,
  finalsItem,
  lastUsedItem,
  memoryItem,
  openaiKeyItem,
  pendingLogsItem,
  profileItem,
  profileSourceItem,
  settingsItem,
  snapshotsItem,
  usageItem,
  type Settings,
} from '../../src/storage';
import { resolveLanguage } from '../../src/ui/i18n';
import { strings, type Strings } from './strings';

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

const detail = (error: unknown) => (error instanceof Error ? error.message : String(error));
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const muted = 'text-[#6e6e73] dark:text-[#a1a1a6]';
const warn = 'text-[#8a590b] dark:text-[#edbe72]';
const bad = 'text-[#d70015] dark:text-[#ff6961]';
const good = 'text-[#23703a] dark:text-[#88d59e]';
const card =
  'rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] dark:border-white/10 dark:bg-[#1c1c1e]';
const button =
  'h-8 flex-none rounded-lg bg-black/[0.05] px-3 text-[13px] font-medium hover:bg-black/[0.085] disabled:opacity-40 dark:bg-white/10 dark:hover:bg-white/15';
const iconButton = `grid h-7 w-7 flex-none place-items-center rounded-full ${muted} hover:bg-black/[0.05] dark:hover:bg-white/10`;
const field =
  'h-8 min-w-0 rounded-lg border border-black/10 bg-transparent px-2.5 text-[13px] dark:border-white/15';
const input = `${field} w-full`;
const select = 'h-8 rounded-lg border border-black/10 bg-transparent px-2 text-[13px] dark:border-white/15';
const link = 'flex-none text-[13px] font-medium underline underline-offset-2';

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

/** A label, what it's set to, and what to do about it. */
function Row({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-3 text-[13px]">
      <span className={`w-20 flex-none ${muted}`}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

type Connection =
  | { state: 'checking' }
  | { state: 'connected'; accounts: number }
  | { state: 'signedOut' }
  | { state: 'unreachable'; detail: string };

/** Outbox, and what this browser copies from it: the profile and the resumes. Checked when the page opens. */
function StatusSection({ s, settings }: { s: Strings; settings: Settings }) {
  const profile = useItem(profileItem);
  const source = useItem(profileSourceItem);
  const pending = useItem(pendingLogsItem) ?? [];
  const [connection, setConnection] = useState<Connection>({ state: 'checking' });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const check = () =>
    loadSnapshot(true).then(
      (next) => {
        setSnapshot(next);
        setConnection({ state: 'connected', accounts: next.accounts.length });
        void flushQueue();
        void syncProfile().catch(() => undefined);
      },
      (error: unknown) => {
        setSnapshot(null);
        setConnection(
          error instanceof OutboxSignedOut
            ? { state: 'signedOut' }
            : { state: 'unreachable', detail: detail(error) },
        );
      },
    );
  const retry = () => {
    setConnection({ state: 'checking' });
    void check();
  };
  // Checks when the page opens and whenever the address changes.
  useEffect(() => void check(), [settings.outboxUrl]);
  const onOutbox = (label: string) => (
    <a className={link} href={settings.outboxUrl} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
  const resumes = snapshot?.resumes.filter((resume) => resume.file) ?? [];
  const missing = profile ? missingItems(profile).length : 0;
  return (
    <Section title={s('status')}>
      <Row
        label="Outbox"
        action={
          connection.state === 'signedOut' ? (
            onOutbox(s('signIn'))
          ) : connection.state === 'unreachable' ? (
            <button className={link} onClick={retry}>
              {s('retry')}
            </button>
          ) : undefined
        }
      >
        {connection.state === 'checking' && <span className={muted}>{s('checking')}</span>}
        {connection.state === 'connected' && s('connected', { n: connection.accounts })}
        {connection.state === 'signedOut' && <span className={warn}>{s('signedOut')}</span>}
        {connection.state === 'unreachable' && (
          <span className={bad}>{s('unreachable', { detail: connection.detail })}</span>
        )}
      </Row>
      {profile !== undefined && (
        <Row label={s('profile')} action={onOutbox(profile ? s('edit') : s('fillIn'))}>
          {profile ? (
            <p className="truncate">
              {profile.name.first} {profile.name.last}
              {missing > 0 && <span className={warn}> · {s('missing', { n: missing })}</span>}
              {/* Offline, the copy here is what fills: say how old it is. */}
              {source && connection.state !== 'connected' && connection.state !== 'checking' && (
                <span className={muted}> · {s('copyFrom', { when: when(source.syncedAt) })}</span>
              )}
            </p>
          ) : (
            <span className={warn}>{s('noProfile')}</span>
          )}
        </Row>
      )}
      {snapshot && (
        <Row label={s('resumes')} action={onOutbox(s('manage'))}>
          {resumes.length ? (
            <p className="truncate" title={resumes.map((resume) => resume.name).join('\n')}>
              {resumes.map((resume) => resume.name).join(', ')}
            </p>
          ) : (
            <span className={warn}>{s('noResumes')}</span>
          )}
        </Row>
      )}
      {pending.length > 0 && (
        <Row label={s('queue')}>
          <span className={warn}>{s('queued', { n: pending.length })}</span>
        </Row>
      )}
    </Section>
  );
}

function AiSection({ s, settings }: { s: Strings; settings: Settings }) {
  const openai = settings.provider === 'openai';
  const keyItem = openai ? openaiKeyItem : apiKeyItem;
  const key = useItem(keyItem) ?? '';
  const usage = useItem(usageItem) ?? [];
  const [draft, setDraft] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const save = (change: Partial<Settings>) => void settingsItem.setValue({ ...settings, ...change });
  const month = new Date().toLocaleDateString('en-CA').slice(0, 7);
  const thisMonth = usage.filter((day) => day.day.startsWith(month));
  const cost = thisMonth.reduce((sum, day) => sum + day.cost, 0);
  const tokens = thisMonth.reduce((sum, day) => sum + day.inputTokens + day.outputTokens, 0);
  const verify = () =>
    checkKey().then((check) =>
      setResult(
        check.ok
          ? { ok: true, text: s('keyOk') }
          : { ok: false, text: s('keyBad', { detail: check.error ?? '' }) },
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
  return (
    <Section
      title={s('ai')}
      aside={
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={settings.aiEnabled}
            onChange={(event) => save({ aiEnabled: event.target.checked })}
          />
          {s('aiEnabled')}
        </label>
      }
    >
      {!settings.aiEnabled ? (
        <p className={`text-[13px] ${muted}`}>{s('aiOff')}</p>
      ) : (
        <>
          <Row label={s('provider')}>
            <select
              className={select}
              value={settings.provider}
              onChange={(event) => {
                setResult(null);
                save({ provider: event.target.value as Settings['provider'] });
              }}
            >
              <option value="openai">{s('providerOpenai')}</option>
              <option value="anthropic">{s('providerAnthropic')}</option>
            </select>
          </Row>
          {openai && (
            <Row label={s('baseUrl')}>
              <input
                className={input}
                defaultValue={settings.openaiBaseUrl}
                key={settings.openaiBaseUrl}
                placeholder="https://api.openai.com/v1"
                onBlur={(event) => {
                  const address = event.target.value.trim();
                  if (address !== settings.openaiBaseUrl) save({ openaiBaseUrl: address });
                }}
              />
            </Row>
          )}
          <Row label="API key">
            <div className="flex gap-2">
              <input
                className={input}
                type="password"
                autoComplete="off"
                placeholder={key ? `••••${key.slice(-4)}` : openai ? 'sk-…' : 'sk-ant-…'}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveKey();
                }}
              />
              <button className={button} disabled={!draft.trim() && !key} onClick={() => void saveKey()}>
                {draft.trim() ? s('save') : s('check')}
              </button>
            </div>
          </Row>
          {result && (
            <Row label="">
              <p className={`text-[12px] ${result.ok ? good : bad}`}>{result.text}</p>
            </Row>
          )}
          <Row label={s('model')}>
            {openai ? (
              <div className="flex gap-2">
                <input
                  className={input}
                  list="openai-models"
                  defaultValue={settings.openaiModel}
                  key={settings.openaiModel}
                  onBlur={(event) => {
                    const model = event.target.value.trim();
                    if (model !== settings.openaiModel) save({ openaiModel: model });
                  }}
                />
                <datalist id="openai-models">
                  {models.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
                <button
                  className={button}
                  disabled={!key}
                  onClick={() =>
                    void listOpenAIModels().then(
                      (found) => {
                        setModels(found);
                        setResult({ ok: true, text: s('modelsLoaded', { n: found.length }) });
                      },
                      (error: unknown) => setResult({ ok: false, text: detail(error) }),
                    )
                  }
                >
                  {s('loadModels')}
                </button>
              </div>
            ) : (
              <select
                className={select}
                value={settings.model}
                onChange={(event) => save({ model: event.target.value as Settings['model'] })}
              >
                <option value="claude-opus-5">Claude Opus 5</option>
                <option value="claude-sonnet-5">Claude Sonnet 5</option>
              </select>
            )}
          </Row>
          {/* An OpenAI-compatible endpoint's prices aren't known here: its tokens, not its cost. */}
          <Row label={s('usage')}>
            {openai
              ? s('usageTokens', { tokens: tokens.toLocaleString() })
              : s('usageCost', { cost: cost.toFixed(2) })}
          </Row>
        </>
      )}
    </Section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <div className="mt-2 space-y-1">{children}</div>
    </div>
  );
}

/** Rarely needed: remembered answers, form snapshots, general settings and the data. Closed until opened. */
function MoreSection({ s, settings }: { s: Strings; settings: Settings }) {
  const memory = useItem(memoryItem) ?? [];
  const snapshots = useItem(snapshotsItem) ?? [];
  const save = (change: Partial<Settings>) => void settingsItem.setValue({ ...settings, ...change });
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
  const exportAll = async () =>
    download(`outbox-autofill-${new Date().toISOString().slice(0, 10)}.json`, {
      profile: await profileItem.getValue(),
      settings: await settingsItem.getValue(),
      memory: await memoryItem.getValue(),
      finals: await finalsItem.getValue(),
      snapshots: await snapshotsItem.getValue(),
      usage: await usageItem.getValue(),
    });
  const deleteAll = async () => {
    if (!confirm(s('confirmDelete'))) return;
    await clearResumeCopies();
    await Promise.all([
      profileItem.removeValue(),
      profileSourceItem.removeValue(),
      apiKeyItem.removeValue(),
      openaiKeyItem.removeValue(),
      memoryItem.removeValue(),
      finalsItem.removeValue(),
      snapshotsItem.removeValue(),
      usageItem.removeValue(),
      lastUsedItem.removeValue(),
      pendingLogsItem.removeValue(),
    ]);
  };
  return (
    <details className={`group ${card}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
        {s('more')}
        <ChevronDown size={16} className={`${muted} transition-transform group-open:rotate-180`} />
      </summary>
      <div className="mt-4 space-y-5">
        <Group title={s('memory', { n: memory.length })}>
          {memory.length === 0 && <p className={`text-[13px] ${muted}`}>{s('memoryHelp')}</p>}
          {memory.map((entry) => (
            <div key={entry.key} className="flex items-center gap-3 text-[13px]">
              <p className="min-w-0 flex-1 truncate">
                {entry.label} <span className={muted}>→ {shown(entry.answer)}</span>
              </p>
              <button
                className={iconButton}
                aria-label={s('delete')}
                title={s('delete')}
                onClick={() => void memoryItem.setValue(memory.filter((item) => item.key !== entry.key))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </Group>

        <Group title={s('snapshots', { n: snapshots.length })}>
          {snapshots.length === 0 && <p className={`text-[13px] ${muted}`}>{s('snapshotsHelp')}</p>}
          {snapshots.map((shot) => (
            <div key={shot.id} className="flex items-center gap-3 text-[13px]">
              <p className="min-w-0 flex-1 truncate">
                {shot.ats} · {shot.step ?? shot.url}{' '}
                <span className={muted}>
                  · {s('fields', { n: shot.fields.length })} · {when(shot.at)}
                </span>
              </p>
              <button
                className={iconButton}
                aria-label={s('delete')}
                title={s('delete')}
                onClick={() => void snapshotsItem.setValue(snapshots.filter((item) => item.id !== shot.id))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {snapshots.length > 0 && (
            <button
              className={button}
              onClick={() =>
                download(`outbox-autofill-snapshots-${new Date().toISOString().slice(0, 10)}.json`, snapshots)
              }
            >
              {s('export')}
            </button>
          )}
        </Group>

        <Group title={s('general')}>
          <Row label={s('language')}>
            <select
              className={select}
              value={settings.language}
              onChange={(event) => save({ language: event.target.value as Settings['language'] })}
            >
              <option value="auto">{s('auto')}</option>
              <option value="en">English</option>
              <option value="zh">简体中文</option>
            </select>
          </Row>
          <Row label={s('limit')}>
            <div className="flex items-center gap-2">
              <input
                className={`${field} w-16`}
                type="number"
                min={1}
                max={20}
                value={settings.sameCompanyLimit}
                onChange={(event) => save({ sameCompanyLimit: Number(event.target.value) || 3 })}
              />
              <span className={muted}>{s('limitHelp')}</span>
            </div>
          </Row>
          <Row label="Outbox">
            <input
              className={input}
              defaultValue={settings.outboxUrl}
              key={settings.outboxUrl}
              onBlur={(event) => {
                const address = event.target.value.trim().replace(/\/$/, '');
                if (address && address !== settings.outboxUrl) save({ outboxUrl: address });
              }}
            />
          </Row>
        </Group>

        <Group title={s('data')}>
          <div className="flex gap-2">
            <button className={button} onClick={() => void exportAll()}>
              {s('exportAll')}
            </button>
            <button className={`${button} ${bad}`} onClick={() => void deleteAll()}>
              {s('deleteAll')}
            </button>
          </div>
        </Group>
      </div>
    </details>
  );
}

export function App() {
  const settings = { ...DEFAULT_SETTINGS, ...(useItem(settingsItem) ?? {}) };
  const s = strings(resolveLanguage(settings.language));
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-6 py-10">
      <h1 className="text-[22px] font-semibold">{s('title')}</h1>
      <StatusSection s={s} settings={settings} />
      <AiSection s={s} settings={settings} />
      <MoreSection s={s} settings={settings} />
    </main>
  );
}
