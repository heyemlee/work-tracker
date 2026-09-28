import type { Snapshot } from '@domain/types';
import { useEffect, useState, type ReactNode } from 'react';
import type { WxtStorageItem } from 'wxt/utils/storage';
import { checkKey } from '../../src/background/ai';
import { flushQueue, loadSnapshot, OutboxSignedOut, syncProfile } from '../../src/background/outbox';
import { missingItems } from '../../src/profile/profile';
import { addResume, removeResume, updateResume } from '../../src/resumes';
import {
  apiKeyItem,
  DEFAULT_SETTINGS,
  finalsItem,
  lastUsedItem,
  memoryItem,
  pendingLogsItem,
  profileItem,
  profileSourceItem,
  resumesItem,
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

function Section({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] dark:border-white/10 dark:bg-[#1c1c1e]">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {help && <p className="mt-1 text-[13px] text-[#6e6e73] dark:text-[#a1a1a6]">{help}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

const button =
  'h-8 rounded-lg bg-black/[0.05] px-3 text-[13px] font-medium hover:bg-black/[0.085] dark:bg-white/10 dark:hover:bg-white/15';
const primary =
  'h-8 rounded-lg bg-[#1d1d1f] px-3 text-[13px] font-medium text-white dark:bg-[#f5f5f7] dark:text-[#1c1c1e]';
const input =
  'h-8 w-full rounded-lg border border-black/10 bg-transparent px-2.5 text-[13px] dark:border-white/15';

function ProfileSection({ s, settings }: { s: Strings; settings: Settings }) {
  const profile = useItem(profileItem);
  const source = useItem(profileSourceItem);
  const [status, setStatus] = useState<string | null>(null);
  const sync = () =>
    syncProfile().then(
      (saved) => setStatus(saved ? null : s('noProfileOnOutbox')),
      (error: unknown) =>
        setStatus(
          error instanceof OutboxSignedOut
            ? s('signedOut')
            : s('unreachable', { detail: error instanceof Error ? error.message : String(error) }),
        ),
    );
  // Fetches once when the page opens and whenever the address changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void sync(), [settings.outboxUrl]);
  const missing = profile ? missingItems(profile) : [];
  const when = (iso: string) => new Date(iso).toLocaleString();
  return (
    <Section title={s('profile')} help={s('profileHelp')}>
      {profile ? (
        <p className="text-[13px]">
          <strong>
            {profile.name.first} {profile.name.last}
          </strong>
          {source && (
            <> · {s('synced', { updated: when(source.updatedAt), synced: when(source.syncedAt) })}</>
          )}
        </p>
      ) : (
        <p className="text-[13px] text-[#6e6e73]">{s('noProfile')}</p>
      )}
      {missing.length > 0 && (
        <p className="text-[13px] text-[#8a590b]">
          {s('missing')} <code>{missing.join(', ')}</code>
        </p>
      )}
      {status && <p className="text-[13px] text-[#6e6e73]">{status}</p>}
      <div className="flex gap-2">
        <button className={primary} onClick={() => void sync()}>
          {s('syncNow')}
        </button>
        <a
          className={`${button} inline-flex items-center`}
          href={settings.outboxUrl}
          target="_blank"
          rel="noreferrer"
        >
          {s('editOnOutbox')}
        </a>
      </div>
    </Section>
  );
}

function ResumesSection({ s, snapshot }: { s: Strings; snapshot: Snapshot | null }) {
  const resumes = useItem(resumesItem) ?? [];
  return (
    <Section title={s('resumes')} help={s('resumesHelp')}>
      {resumes.map((resume) => (
        <div key={resume.id} className="flex items-center gap-3 text-[13px]">
          <span className="min-w-0 flex-1 truncate">
            {resume.fileName} <span className="text-[#8a8a8e]">· {Math.round(resume.size / 1024)} KB</span>
          </span>
          <label className="flex items-center gap-2 text-[12px] text-[#6e6e73]">
            {s('outboxVersion')}
            <select
              className="h-8 rounded-lg border border-black/10 bg-transparent px-2 text-[13px] dark:border-white/15"
              value={resume.outboxResumeId ?? ''}
              onChange={(event) => {
                const version = snapshot?.resumes.find((item) => item.id === event.target.value);
                void updateResume(resume.id, {
                  outboxResumeId: version?.id ?? null,
                  label: version?.name ?? resume.fileName,
                });
              }}
            >
              <option value="">{s('none')}</option>
              {snapshot?.resumes.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.name}
                </option>
              ))}
            </select>
          </label>
          <button className={button} onClick={() => void removeResume(resume.id)}>
            {s('delete')}
          </button>
        </div>
      ))}
      <label className={`${primary} inline-flex cursor-pointer items-center`}>
        {s('addResume')}
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void addResume(file, file.name.replace(/\.pdf$/i, ''), null);
            event.target.value = '';
          }}
        />
      </label>
    </Section>
  );
}

function OutboxSection({
  s,
  settings,
  onSnapshot,
}: {
  s: Strings;
  settings: Settings;
  onSnapshot: (snapshot: Snapshot | null) => void;
}) {
  const [url, setUrl] = useState(settings.outboxUrl);
  const [status, setStatus] = useState<string | null>(null);
  const pending = useItem(pendingLogsItem) ?? [];
  const check = () =>
    loadSnapshot(true).then(
      (snapshot) => {
        onSnapshot(snapshot);
        setStatus(s('connected', { n: snapshot.accounts.length }));
        void flushQueue();
      },
      (error: unknown) => {
        onSnapshot(null);
        setStatus(
          error instanceof OutboxSignedOut
            ? s('signedOut')
            : s('unreachable', { detail: error instanceof Error ? error.message : String(error) }),
        );
      },
    );
  // Checks once when the page opens and whenever the address changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void check(), [settings.outboxUrl]);
  return (
    <Section title={s('outbox')} help={s('outboxHelp')}>
      <div className="flex gap-2">
        <input className={input} value={url} onChange={(event) => setUrl(event.target.value)} />
        <button
          className={primary}
          onClick={() => void settingsItem.setValue({ ...settings, outboxUrl: url.replace(/\/$/, '') })}
        >
          {s('save')}
        </button>
        <button className={button} onClick={() => void check()}>
          {s('check')}
        </button>
      </div>
      {status && <p className="text-[13px]">{status}</p>}
      {pending.length > 0 && (
        <p className="text-[13px] text-[#8a590b]">{s('queued', { n: pending.length })}</p>
      )}
      <a className="text-[13px] underline" href={settings.outboxUrl} target="_blank" rel="noreferrer">
        {s('open')}
      </a>
    </Section>
  );
}

function AiSection({ s, settings }: { s: Strings; settings: Settings }) {
  const key = useItem(apiKeyItem) ?? '';
  const usage = useItem(usageItem) ?? [];
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const month = new Date().toLocaleDateString('en-CA').slice(0, 7);
  const monthCost = usage.filter((day) => day.day.startsWith(month)).reduce((sum, day) => sum + day.cost, 0);
  return (
    <Section title={s('ai')} help={s('aiHelp')}>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={settings.aiEnabled}
          onChange={(event) => void settingsItem.setValue({ ...settings, aiEnabled: event.target.checked })}
        />
        {s('aiEnabled')}
      </label>
      <div>
        <p className="text-[13px] font-medium">{s('apiKey')}</p>
        <p className="text-[12px] text-[#6e6e73]">{s('apiKeyHelp')}</p>
        <div className="mt-2 flex gap-2">
          <input
            className={input}
            type="password"
            autoComplete="off"
            placeholder={key ? `••••${key.slice(-4)}` : 'sk-ant-…'}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            className={primary}
            onClick={() => {
              void apiKeyItem.setValue(draft.trim());
              setDraft('');
              setResult(s('saved'));
            }}
          >
            {s('save')}
          </button>
          <button
            className={button}
            disabled={!key}
            onClick={() =>
              void checkKey().then((check) =>
                setResult(check.ok ? s('keyOk') : s('keyBad', { detail: check.error ?? '' })),
              )
            }
          >
            {s('check')}
          </button>
        </div>
        {result && <p className="mt-1 text-[12px]">{result}</p>}
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        {s('model')}
        <select
          className="h-8 rounded-lg border border-black/10 bg-transparent px-2 dark:border-white/15"
          value={settings.model}
          onChange={(event) =>
            void settingsItem.setValue({ ...settings, model: event.target.value as Settings['model'] })
          }
        >
          <option value="claude-opus-5">Claude Opus 5</option>
          <option value="claude-sonnet-5">Claude Sonnet 5</option>
        </select>
      </label>
      <div className="text-[13px]">
        <p className="font-medium">
          {s('usage')} · {s('usageMonth', { cost: monthCost.toFixed(2) })}
        </p>
        <ul className="mt-1 text-[12px] text-[#6e6e73]">
          {usage.slice(0, 7).map((day) => (
            <li key={day.day}>
              {s('usageLine', {
                day: day.day,
                cost: day.cost.toFixed(3),
                tokens: (day.inputTokens + day.outputTokens).toLocaleString(),
              })}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function MemorySection({ s }: { s: Strings }) {
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
    <Section title={s('memory')} help={s('memoryHelp')}>
      {memory.length === 0 && <p className="text-[13px] text-[#6e6e73]">{s('noMemory')}</p>}
      {memory.map((entry) => (
        <div key={entry.key} className="flex items-start gap-3 text-[13px]">
          <div className="min-w-0 flex-1">
            <p className="truncate">{entry.label}</p>
            <p className="truncate text-[#6e6e73]">{shown(entry.answer)}</p>
          </div>
          <button
            className={button}
            onClick={() => void memoryItem.setValue(memory.filter((item) => item.key !== entry.key))}
          >
            {s('delete')}
          </button>
        </div>
      ))}
    </Section>
  );
}

function SnapshotsSection({ s }: { s: Strings }) {
  const snapshots = useItem(snapshotsItem) ?? [];
  return (
    <Section title={s('snapshots')} help={s('snapshotsHelp')}>
      {snapshots.length === 0 && <p className="text-[13px] text-[#6e6e73]">{s('noSnapshots')}</p>}
      {snapshots.map((shot) => (
        <div key={shot.id} className="flex items-center gap-3 text-[13px]">
          <span className="min-w-0 flex-1 truncate">
            {shot.ats} · {shot.step ?? shot.url} · {s('fields', { n: shot.fields.length })} ·{' '}
            {new Date(shot.at).toLocaleString()}
          </span>
          <button
            className={button}
            onClick={() => void snapshotsItem.setValue(snapshots.filter((item) => item.id !== shot.id))}
          >
            {s('delete')}
          </button>
        </div>
      ))}
      {snapshots.length > 0 && (
        <button
          className={primary}
          onClick={() =>
            download(`outbox-autofill-snapshots-${new Date().toISOString().slice(0, 10)}.json`, snapshots)
          }
        >
          {s('export')}
        </button>
      )}
    </Section>
  );
}

function SettingsSection({ s, settings }: { s: Strings; settings: Settings }) {
  return (
    <Section title={s('settings')}>
      <label className="flex items-center gap-2 text-[13px]">
        {s('language')}
        <select
          className="h-8 rounded-lg border border-black/10 bg-transparent px-2 dark:border-white/15"
          value={settings.language}
          onChange={(event) =>
            void settingsItem.setValue({ ...settings, language: event.target.value as Settings['language'] })
          }
        >
          <option value="auto">{s('auto')}</option>
          <option value="en">English</option>
          <option value="zh">简体中文</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        {s('limit')}
        <input
          className="h-8 w-16 rounded-lg border border-black/10 bg-transparent px-2 dark:border-white/15"
          type="number"
          min={1}
          max={20}
          value={settings.sameCompanyLimit}
          onChange={(event) =>
            void settingsItem.setValue({ ...settings, sameCompanyLimit: Number(event.target.value) || 3 })
          }
        />
      </label>
    </Section>
  );
}

function DataSection({ s }: { s: Strings }) {
  const exportAll = async () =>
    download(`outbox-autofill-${new Date().toISOString().slice(0, 10)}.json`, {
      profile: await profileItem.getValue(),
      settings: await settingsItem.getValue(),
      memory: await memoryItem.getValue(),
      finals: await finalsItem.getValue(),
      resumes: await resumesItem.getValue(),
      snapshots: await snapshotsItem.getValue(),
      usage: await usageItem.getValue(),
    });
  const deleteAll = async () => {
    if (!confirm(s('confirmDelete'))) return;
    for (const resume of await resumesItem.getValue()) await removeResume(resume.id);
    await Promise.all([
      profileItem.removeValue(),
      profileSourceItem.removeValue(),
      apiKeyItem.removeValue(),
      memoryItem.removeValue(),
      finalsItem.removeValue(),
      snapshotsItem.removeValue(),
      usageItem.removeValue(),
      lastUsedItem.removeValue(),
      pendingLogsItem.removeValue(),
    ]);
  };
  return (
    <Section title={s('data')}>
      <div className="flex gap-2">
        <button className={button} onClick={() => void exportAll()}>
          {s('exportAll')}
        </button>
        <button className={`${button} text-[#d70015]`} onClick={() => void deleteAll()}>
          {s('deleteAll')}
        </button>
      </div>
    </Section>
  );
}

export function App() {
  const settings = { ...DEFAULT_SETTINGS, ...(useItem(settingsItem) ?? {}) };
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const s = strings(resolveLanguage(settings.language));
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-6 py-10">
      <header>
        <h1 className="text-[22px] font-semibold">{s('title')}</h1>
        <p className="mt-1 text-[14px] text-[#6e6e73] dark:text-[#a1a1a6]">{s('subtitle')}</p>
      </header>
      <ProfileSection s={s} settings={settings} />
      <ResumesSection s={s} snapshot={snapshot} />
      <OutboxSection s={s} settings={settings} onSnapshot={setSnapshot} />
      <AiSection s={s} settings={settings} />
      <MemorySection s={s} />
      <SnapshotsSection s={s} />
      <SettingsSection s={s} settings={settings} />
      <DataSection s={s} />
    </main>
  );
}
