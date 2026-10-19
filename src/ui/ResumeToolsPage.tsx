import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronDown, Download, FileText, Settings2, Upload } from 'lucide-react';
import clsx from 'clsx';
import {
  localToolRequest,
  parseLocalResume,
  type ExtractedResume,
  type ModelChoice,
  type ModelStatus,
  type ParsedResume,
  type ParseMethod,
  type Provider,
} from '../data/localTools';
import type { ResumeFacts } from '../domain/profile';
import { useI18n } from '../i18n/context';
import { setLeaveGuard } from '../state/router';
import { showToast } from '../state/toasts';
import { ToolDialog, ToolNotice, toolInput, toolPage } from './LocalTools';
import { PetDots } from './pet/Pet';
import { Button } from './primitives';

const STATUS_KEY = ['local-tools', 'resume-status'];

export function ResumeToolsPage({ onReview }: { onReview: (facts: ResumeFacts) => void }) {
  const { t } = useI18n();
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => localToolRequest<ModelStatus>('/api/resumes/status'),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [sourceReady, setSourceReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [method, setMethod] = useState<ParseMethod>('function-calling');
  const [result, setResult] = useState<ParsedResume | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const handingOff = useRef(false);
  const dirty = !!text || !!result || settingsDirty;
  useEffect(() => {
    if (!dirty && !busy) return;
    setLeaveGuard(() => {
      if (handingOff.current) return true;
      if (busy) {
        showToast({ message: t('resumeTools.busyLeave') });
        return false;
      }
      return window.confirm(t('resumeTools.leave'));
    });
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty, busy, t]);
  const read = async (file: File) => {
    if (busy) return;
    if (file.size === 0 || file.size > 5 * 1024 * 1024 || !/\.(pdf|docx)$/i.test(file.name)) {
      showToast({ message: t('resumeTools.tooLarge') });
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const extracted = await localToolRequest<ExtractedResume>('/api/resumes/extract', 'POST', form);
      setText(extracted.text);
      setFilename(file.name);
      setWarnings(extracted.warnings);
      setSourceReady(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const parse = async () => {
    if (busy) return;
    setBusy(true);
    setParsing(true);
    setError(null);
    setResult(null);
    try {
      setResult(await parseLocalResume(text, method));
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
      setParsing(false);
    }
  };
  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result.facts, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'resume-facts.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const canParse = status.data?.enabled && status.data.modelPolicy.canParse;
  const step = result ? 2 : sourceReady ? 1 : 0;
  return (
    <main className={`${toolPage} !max-w-[820px]`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{t('nav.resumeTools')}</h1>
          <p className="mt-1 text-[14px] text-fg-2">{t('resumeTools.intro')}</p>
        </div>
        {status.isSuccess && (
          <Button variant="ghost" disabled={busy} onClick={() => setSettingsOpen(true)}>
            <Settings2 className="size-4" />
            {t('resumeTools.options')}
            {settingsDirty && <span className="size-1.5 rounded-full bg-accent" />}
          </Button>
        )}
      </header>
      {status.isPending ? (
        <ToolNotice loading />
      ) : status.isError ? (
        <ToolNotice error={status.error} retry={() => void status.refetch()} />
      ) : (
        <>
          <ol className="my-8 flex items-center" aria-label={t('nav.resumeTools')}>
            {(['resumeTools.stepFile', 'resumeTools.stepText', 'resumeTools.stepResult'] as const).map(
              (label, index) => (
                <li
                  key={label}
                  aria-current={step === index ? 'step' : undefined}
                  className={clsx(
                    'flex min-w-0 flex-1 items-center gap-2 text-[12px] max-[360px]:flex-col max-[360px]:gap-1.5 max-[360px]:text-center sm:text-[13px]',
                    index > step ? 'text-fg-3' : 'text-fg',
                  )}
                >
                  <span
                    className={clsx(
                      'grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-medium',
                      index === step
                        ? 'bg-accent text-white'
                        : index < step
                          ? 'bg-fill text-accent'
                          : 'border border-hairline',
                    )}
                  >
                    {index < step ? <Check className="size-3.5" /> : index + 1}
                  </span>
                  <span>{t(label)}</span>
                  {index < 2 && <span className="mx-1 hidden h-px flex-1 bg-hairline sm:block" />}
                </li>
              ),
            )}
          </ol>
          <input
            ref={fileInput}
            aria-label={t('resumeTools.file')}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={busy}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void read(file);
            }}
          />
          {!sourceReady ? (
            <>
              <section
                className={clsx(
                  'card flex min-h-[340px] flex-col items-center justify-center border-dashed px-5 py-12 text-center transition-colors sm:min-h-[380px]',
                  dragging && 'border-accent bg-accent/5',
                )}
                aria-busy={busy}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!busy) setDragging(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files[0];
                  if (file) void read(file);
                }}
              >
                <span className="mb-5 grid size-14 place-items-center rounded-2xl bg-fill text-fg-2">
                  {busy ? <PetDots size={30} /> : <Upload className="size-6" strokeWidth={1.5} />}
                </span>
                <h2 className="text-[21px] font-semibold tracking-tight">
                  {t(busy ? 'resumeTools.reading' : 'resumeTools.startTitle')}
                </h2>
                <p className="mt-2 max-w-sm text-[14px] leading-6 text-fg-2">{t('resumeTools.startBody')}</p>
                <Button
                  variant="primary"
                  className="mt-6"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {t('resumeTools.choose')}
                  <ArrowRight className="size-4" />
                </Button>
                <p className="mt-3 text-[12px] text-fg-3">{t('resumeTools.formats')}</p>
              </section>
              <div className="mt-4 text-center">
                <Button variant="ghost" disabled={busy} onClick={() => setSourceReady(true)}>
                  {t('resumeTools.paste')}
                </Button>
                <p className="mx-auto mt-4 max-w-md text-[12px] leading-5 text-fg-3">
                  {t('resumeTools.localRead')}
                </p>
              </div>
            </>
          ) : result ? (
            <section className="card overflow-hidden" aria-label={t('resumeTools.preview')}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-5 py-4 sm:px-6">
                <p className="flex items-center gap-2 text-[13px] font-medium">
                  <span className="grid size-6 place-items-center rounded-full bg-fill text-accent">
                    <Check className="size-3.5" />
                  </span>
                  {t('resumeTools.ready')}
                </p>
                <Button variant="ghost" onClick={() => setResult(null)}>
                  {t('resumeTools.editSource')}
                </Button>
              </div>
              <ResumePreview facts={result.facts} />
              <details className="mx-5 border-t border-hairline py-4 sm:mx-6">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] text-fg-3 [&::-webkit-details-marker]:hidden">
                  {t('resumeTools.raw')}
                  <ChevronDown className="size-3.5" />
                </summary>
                <p className="mt-3 text-[12px] text-fg-3">
                  {result.model} · {result.method}
                </p>
                <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-fill p-3 text-[12px] whitespace-pre-wrap break-words">
                  {JSON.stringify(result.facts, null, 2)}
                </pre>
              </details>
              <footer className="border-t border-hairline bg-fill/30 p-5 sm:p-6">
                {settingsDirty && (
                  <button
                    className="mb-3 block text-left text-[13px] text-accent"
                    onClick={() => setSettingsOpen(true)}
                  >
                    {t('resumeTools.settingsUnsaved')}
                  </button>
                )}
                <p className="text-[13px] leading-5 text-fg-2">{t('resumeTools.reviewHint')}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    disabled={busy || settingsDirty}
                    onClick={() => {
                      handingOff.current = true;
                      onReview(result.facts);
                    }}
                  >
                    {t('resumeTools.review')}
                    <ArrowRight className="size-4" />
                  </Button>
                  <Button variant="ghost" onClick={download}>
                    <Download className="size-4" />
                    {t('resumeTools.download')}
                  </Button>
                </div>
              </footer>
            </section>
          ) : (
            <section className="card overflow-hidden" aria-busy={busy}>
              <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="size-5 shrink-0 text-fg-3" />
                  <p className="truncate text-[14px] font-medium">{filename || t('resumeTools.pasted')}</p>
                </div>
                <Button variant="ghost" disabled={busy} onClick={() => fileInput.current?.click()}>
                  {t('resumeTools.replace')}
                </Button>
              </div>
              <div className="p-5 sm:p-6">
                <p className="mb-3 text-[13px] leading-5 text-fg-2">{t('resumeTools.textHint')}</p>
                {warnings.map((warning, i) => (
                  <p role="status" className="mb-3 text-[13px] text-fg-2" key={i}>
                    {warning}
                  </p>
                ))}
                <textarea
                  aria-label={t('resumeTools.text')}
                  autoFocus={!filename}
                  value={text}
                  disabled={busy}
                  maxLength={60000}
                  rows={12}
                  placeholder={t('resumeTools.empty')}
                  className={`${toolInput} resize-y text-[13px] leading-6`}
                  onChange={(event) => setText(event.target.value)}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-fg-3">
                  <span>{t('resumeTools.characters', { n: text.length })}</span>
                  <button
                    className="flex items-center gap-1 rounded-md px-1 py-1 hover:text-fg"
                    disabled={busy}
                    onClick={() => setSettingsOpen(true)}
                  >
                    {status.data.model || t('resumeTools.configure')}
                    <Settings2 className="size-3" />
                  </button>
                </div>
              </div>
              <footer className="border-t border-hairline px-5 py-4 sm:px-6">
                {!canParse && <p className="mb-3 text-[13px] text-fg-2">{t('resumeTools.disabled')}</p>}
                {settingsDirty && (
                  <button
                    className="mb-3 block text-left text-[13px] text-accent"
                    onClick={() => setSettingsOpen(true)}
                  >
                    {t('resumeTools.settingsUnsaved')}
                  </button>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="max-w-[320px] text-[12px] leading-5 text-fg-3">
                    {t('resumeTools.paymentNote')}
                  </p>
                  <Button
                    variant="primary"
                    disabled={busy || !text.trim() || !canParse || settingsDirty}
                    onClick={() => void parse()}
                  >
                    {busy && <PetDots size={20} />}
                    {parsing ? t('resumeTools.parsing') : t('resumeTools.parseShort')}
                    {!busy && <ArrowRight className="size-4" />}
                  </Button>
                </div>
              </footer>
            </section>
          )}
          {error != null && <ToolNotice error={error} />}
          <ModelSettings
            key={`${status.data.provider}:${status.data.model}:${status.data.enabled}:${status.data.openaiBaseUrl}`}
            status={status.data}
            busy={busy}
            setBusy={setBusy}
            onDirty={setSettingsDirty}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            method={method}
            setMethod={setMethod}
          />
        </>
      )}
    </main>
  );
}

function ResumePreview({ facts }: { facts: ResumeFacts }) {
  const { t } = useI18n();
  const contact = [
    facts.phone,
    [facts.location.city, facts.location.state, facts.location.country].filter(Boolean).join(', '),
    ...Object.values(facts.links),
  ].filter(Boolean);
  return (
    <div className="space-y-6 p-5 break-words sm:p-6">
      <div>
        <h2 className="text-[24px] font-semibold tracking-tight">
          {[facts.name.first, facts.name.last].filter(Boolean).join(' ') || t('resumeTools.noName')}
        </h2>
        {contact.length > 0 && (
          <p className="mt-2 text-[13px] leading-6 break-words text-fg-2">{contact.join(' · ')}</p>
        )}
        {facts.summary && <p className="mt-4 text-[14px] leading-6 text-fg-2">{facts.summary}</p>}
      </div>
      {facts.experience.length > 0 && (
        <PreviewSection title={t('resumeTools.experience')}>
          {facts.experience.map((item, i) => (
            <div key={i}>
              <p className="text-[14px] font-medium">
                {[item.title, item.company].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-1 text-[12px] text-fg-3">
                {[item.start, item.end].filter(Boolean).join(' – ')}
                {item.location && ` · ${item.location}`}
              </p>
              {item.description && (
                <p className="mt-2 text-[13px] leading-6 whitespace-pre-line text-fg-2">{item.description}</p>
              )}
            </div>
          ))}
        </PreviewSection>
      )}
      {facts.education.length > 0 && (
        <PreviewSection title={t('resumeTools.education')}>
          {facts.education.map((item, i) => (
            <div key={i}>
              <p className="text-[14px] font-medium">{item.school}</p>
              <p className="mt-1 text-[13px] text-fg-2">
                {[item.degree, item.field, item.end].filter(Boolean).join(' · ')}
              </p>
            </div>
          ))}
        </PreviewSection>
      )}
      {(facts.skills.length > 0 || facts.languages.length > 0) && (
        <PreviewSection title={t('resumeTools.skills')}>
          <div className="flex flex-wrap gap-2">
            {[...new Set([...facts.skills, ...facts.languages])].map((skill) => (
              <span key={skill} className="rounded-lg bg-fill px-2.5 py-1 text-[12px] text-fg-2">
                {skill}
              </span>
            ))}
          </div>
        </PreviewSection>
      )}
    </div>
  );
}

function PreviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-hairline pt-5">
      <h3 className="text-[11px] font-semibold tracking-[0.08em] text-fg-3 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function ModelSettings({
  status,
  busy,
  setBusy,
  onDirty,
  open,
  onOpenChange,
  method,
  setMethod,
}: {
  status: ModelStatus;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onDirty: (value: boolean) => void;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  method: ParseMethod;
  setMethod: (value: ParseMethod) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<Provider>(status.provider);
  const [model, setModel] = useState(status.model ?? '');
  const [baseUrl, setBaseUrl] = useState(status.openaiBaseUrl);
  const [enabled, setEnabled] = useState(status.enabled);
  const [catalog, setCatalog] = useState<ModelChoice[]>([]);
  const [error, setError] = useState<unknown>(null);
  const dirty =
    provider !== status.provider ||
    model !== (status.model ?? '') ||
    enabled !== status.enabled ||
    baseUrl !== status.openaiBaseUrl;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  const choices = [...status.models, ...catalog].filter(
    (choice, i, all) =>
      choice.provider === provider &&
      all.findIndex((item) => item.provider === choice.provider && item.model === choice.model) === i,
  );
  const action = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ToolDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('resumeTools.options')}
      description={t('resumeTools.settingsShort')}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {dirty && (
            <Button
              disabled={busy}
              variant="ghost"
              onClick={() => {
                setProvider(status.provider);
                setModel(status.model ?? '');
                setBaseUrl(status.openaiBaseUrl);
                setEnabled(status.enabled);
              }}
            >
              {t('resumeTools.discardSettings')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={busy || !model || !dirty}
            onClick={() =>
              void action(async () => {
                const saved = await localToolRequest<ModelStatus>('/api/resumes/settings', 'PUT', {
                  provider,
                  model,
                  enabled,
                  ...(provider === 'openai' ? { baseUrl } : {}),
                });
                queryClient.setQueryData(STATUS_KEY, saved);
                onDirty(false);
                showToast({ message: t('resumeTools.settingsSaved') });
              })
            }
          >
            {t('resumeTools.saveSettings')}
          </Button>
        </div>
      }
    >
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Setting label={t('resumeTools.provider')}>
            <select
              className={toolInput}
              value={provider}
              onChange={(e) => {
                const next = e.target.value as Provider;
                setProvider(next);
                setModel(status.models.find((item) => item.provider === next)?.model ?? '');
              }}
            >
              <option value="openai">OpenAI / Compatible</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </Setting>
          <Setting label={t('resumeTools.model')}>
            <select className={toolInput} value={model} onChange={(e) => setModel(e.target.value)}>
              {!choices.some((c) => c.model === model) && <option value={model}>{model || '—'}</option>}
              {choices.map((choice) => (
                <option key={choice.model} value={choice.model} disabled={choice.selectable === false}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Setting>
        </div>
        <Setting label={t('resumeTools.method')}>
          <select
            className={toolInput}
            value={method}
            onChange={(e) => setMethod(e.target.value as ParseMethod)}
          >
            <option value="function-calling">{t('resumeTools.function')}</option>
            <option value="structured-output">{t('resumeTools.structured')}</option>
          </select>
        </Setting>
        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--accent)]"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t('resumeTools.enabled')}
        </label>
        <details className="border-t border-hairline pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] text-fg-2 [&::-webkit-details-marker]:hidden">
            {t('resumeTools.advanced')}
            <ChevronDown className="size-4" />
          </summary>
          <div className="mt-4 space-y-3">
            <p className="text-[12px] leading-5 text-fg-3">{t('resumeTools.settingsHint')}</p>
            <p className="text-[12px] text-fg-2">
              {t(status.configuredProviders[provider] ? 'resumeTools.keyReady' : 'resumeTools.keyMissing')}
            </p>
            {provider === 'openai' && (
              <>
                <Setting label={t('resumeTools.baseUrl')}>
                  <input
                    className={toolInput}
                    type="url"
                    value={baseUrl}
                    onChange={(e) => {
                      setBaseUrl(e.target.value);
                      setCatalog([]);
                    }}
                  />
                </Setting>
                <p className="text-[12px] leading-5 text-fg-3">{t('resumeTools.baseHint')}</p>
                <Button
                  disabled={!status.configuredProviders.openai}
                  onClick={() =>
                    void action(async () => {
                      const data = await localToolRequest<{ models: ModelChoice[] }>(
                        '/api/resumes/models',
                        'POST',
                        { provider: 'openai', baseUrl },
                      );
                      setCatalog(data.models);
                    })
                  }
                >
                  {t('resumeTools.models')}
                </Button>
              </>
            )}
            <Button
              disabled={dirty || !status.hasKey}
              onClick={() =>
                void action(async () => {
                  await localToolRequest('/api/resumes/check-connection', 'POST');
                  showToast({ message: t('resumeTools.connected') });
                })
              }
            >
              {t('resumeTools.check')}
            </Button>
          </div>
        </details>
      </fieldset>
      {error != null && <ToolNotice error={error} />}
    </ToolDialog>
  );
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[12px] text-fg-2">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}
