import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AtSign,
  Check,
  CircleCheck,
  FileText,
  FileUp,
  LoaderCircle,
  Plus,
  Puzzle,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import {
  ExtensionError,
  openExtensionOptions,
  readResumeWithExtension,
  useExtension,
} from '../data/extension';
import { formatSize, loadResumePdf, resumeProblem, uploadResume } from '../data/resumes';
import { PROFILE_KEY, useCurrentUser, useProfile, useRepository } from '../data/store';
import {
  applyResume,
  completeness,
  emptyProfile,
  missingItems,
  profileSchema,
  type Profile,
  type ResumeFacts,
  type ResumeParts,
  type SavedProfile,
} from '../domain/profile';
import { versionName } from '../domain/resumes';
import { ACCOUNT_COLORS, type Id, type Snapshot } from '../domain/types';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useI18n } from '../i18n/context';
import { updatePrefs, updateSetup, usePrefs } from '../state/prefs';
import { navigate, PAGE_PATHS } from '../state/router';
import { showToast } from '../state/toasts';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { Link } from './Link';
import { Brand, Button, IconButton } from './primitives';
import { Grid, SectionBody, Text, Toggle } from './ProfileFields';
import { ResumeReview } from './ProfilePage';
import { describeIssue, extensionText } from './profileText';

/** The guide's steps: emails, resumes, the extension, a resume read into the profile, the rules-only answers, done. */
export const GUIDE_STEPS = 6;

const stepPath = (step: number) => `${PAGE_PATHS.welcome}?step=${step}`;

/** Setting Outbox up the first time, one skippable step at a time. Opens by itself for a new owner. */
export function Guide({ snapshot, step: requested }: { snapshot: Snapshot; step: number }) {
  const { t } = useI18n();
  const step = Math.min(GUIDE_STEPS, Math.max(1, Math.round(requested) || 1));
  const go = (next: number) => navigate(stepPath(next));
  // Finished or put off, the guide stops opening by itself; the account menu still has it.
  const leave = () => {
    updateSetup({ guideSeen: true });
    navigate(PAGE_PATHS.applications);
  };

  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 pt-5 sm:px-10 sm:pt-6">
        <div className="flex flex-1 items-center sm:w-[200px] sm:flex-none">
          <Brand />
        </div>
        <div className="order-last flex w-full flex-col items-center gap-2 sm:order-none sm:w-auto sm:flex-1">
          <div
            role="progressbar"
            aria-valuenow={step}
            aria-valuemin={1}
            aria-valuemax={GUIDE_STEPS}
            aria-label={t('guide.step', { n: step, total: GUIDE_STEPS })}
            className="flex gap-1.5"
          >
            {Array.from({ length: GUIDE_STEPS }, (_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => go(index + 1)}
                aria-label={t('guide.step', { n: index + 1, total: GUIDE_STEPS })}
                className={clsx(
                  'h-1 w-9 rounded-full transition-colors sm:w-11',
                  index < step ? 'bg-accent' : 'bg-fill-2 hover:bg-fg-3/40',
                )}
              />
            ))}
          </div>
          <span className="text-[12px] text-fg-2">{t('guide.step', { n: step, total: GUIDE_STEPS })}</span>
        </div>
        <div className="text-right sm:w-[200px]">
          {step < GUIDE_STEPS && (
            <button type="button" onClick={leave} className="text-[13px] text-fg-2 hover:text-fg">
              {t('guide.later')}
            </button>
          )}
        </div>
      </header>

      <main className="px-4 pt-8 pb-16 sm:pt-10">
        {step === 1 && <AccountsStep snapshot={snapshot} go={go} />}
        {step === 2 && <ResumesStep snapshot={snapshot} go={go} />}
        {step === 3 && <ExtensionStep go={go} />}
        {step === 4 && <ReadStep snapshot={snapshot} go={go} />}
        {step === 5 && <AuthorizationStep go={go} />}
        {step === 6 && <DoneStep snapshot={snapshot} onEnter={leave} />}
      </main>
    </div>
  );
}

/** A step's glass card: an icon, a title, what it's for, its content and its way on. */
function Step({
  icon,
  title,
  body,
  wide = false,
  aside,
  footer,
  children,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  wide?: boolean;
  aside?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const paneRef = useRef<HTMLElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: 28, bevel: 18 });
  return (
    <section
      ref={paneRef}
      style={glass.style}
      className={clsx(
        'glass glass-strong mx-auto rounded-[28px] px-6 pt-8 pb-6 sm:px-9 sm:pt-9',
        wide ? 'max-w-[820px]' : 'max-w-[600px]',
      )}
    >
      {glass.filter}
      {(icon || aside) && (
        <div className="mb-4 flex items-start gap-3">
          {icon && (
            <span
              aria-hidden="true"
              className="grid size-13 place-items-center rounded-[16px] bg-fill text-fg"
            >
              {icon}
            </span>
          )}
          {aside && <span className="ml-auto">{aside}</span>}
        </div>
      )}
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{title}</h1>
      {body && <p className="mt-2 text-[14px] leading-relaxed text-fg-2">{body}</p>}
      <div className="mt-6">{children}</div>
      <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2">{footer}</div>
    </section>
  );
}

function Footer({
  back,
  skip,
  skipLabel,
  next,
  nextLabel,
  nextDisabled = false,
  busy = false,
}: {
  back?: () => void;
  skip?: () => void;
  skipLabel?: string;
  next: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      {back && (
        <button type="button" onClick={back} className="text-[14px] text-fg-2 hover:text-fg">
          {t('guide.back')}
        </button>
      )}
      <span className="flex-1" />
      {skip && (
        <button type="button" onClick={skip} className="text-[14px] text-fg-2 hover:text-fg">
          {skipLabel ?? t('guide.skip')}
        </button>
      )}
      <Button
        variant="primary"
        className="h-10 px-5 text-[14px]"
        disabled={nextDisabled || busy}
        onClick={next}
      >
        {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
        {nextLabel ?? t('guide.next')}
      </Button>
    </>
  );
}

type Go = (step: number) => void;

function AccountsStep({ snapshot, go }: { snapshot: Snapshot; go: Go }) {
  const { t } = useI18n();
  const run = useRepository();
  const { data: user } = useCurrentUser();
  const [invalid, setInvalid] = useState(false);
  const used = new Set(snapshot.applications.map((application) => application.accountId));
  const signIn = user?.email.toLowerCase() ?? null;
  const known = new Set(snapshot.accounts.map((account) => account.email.toLowerCase()));

  const add = (email: string) => {
    const count = snapshot.accounts.length;
    const color = ACCOUNT_COLORS[count % ACCOUNT_COLORS.length] ?? 'gray';
    // The label is no longer shown; it stays as a short internal name.
    const label = String.fromCharCode(65 + (count % 26));
    void run((repo) => repo.saveAccount({ label, email, color }));
  };

  return (
    <Step
      icon={<AtSign className="size-6" />}
      title={t('guide.accounts.title')}
      body={t('guide.accounts.body')}
      footer={<Footer next={() => go(2)} nextDisabled={snapshot.accounts.length === 0} />}
    >
      <ul className="space-y-2">
        {snapshot.accounts.map((account) => (
          <li key={account.id} className="card flex h-12 items-center gap-3 pr-1.5 pl-4">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: `var(--acc-${account.color})` }}
            />
            <span className="min-w-0 flex-1 truncate text-[14px]">{account.email}</span>
            {account.email.toLowerCase() === signIn && (
              <span className="shrink-0 text-[12px] text-fg-3">{t('guide.accounts.signIn')}</span>
            )}
            {!used.has(account.id) && (
              <IconButton
                label={t('guide.accounts.remove', { email: account.email })}
                onClick={() => void run((repo) => repo.deleteAccount(account.id))}
                className="size-8 text-fg-3 hover:text-danger"
              >
                <X className="size-4" />
              </IconButton>
            )}
          </li>
        ))}
        {user && signIn && !known.has(signIn) && (
          <li>
            <button
              type="button"
              onClick={() => add(user.email)}
              className="flex h-12 w-full items-center gap-3 rounded-[18px] bg-fill px-4 text-left text-[14px] transition-colors hover:bg-fill-2"
            >
              <Plus className="size-4 text-fg-2" aria-hidden="true" />
              <span className="flex-1">{t('guide.accounts.suggest', { email: user.email })}</span>
              <span className="text-[12px] text-fg-3">{t('guide.accounts.signIn')}</span>
            </button>
          </li>
        )}
        <li>
          <label className="flex h-12 items-center gap-3 rounded-[18px] border-[1.5px] border-dashed border-hairline px-4 text-fg-3 focus-within:border-fg-3">
            <Plus className="size-4 shrink-0" aria-hidden="true" />
            <input
              type="email"
              placeholder={t('guide.accounts.add')}
              aria-label={t('guide.accounts.add')}
              onChange={() => setInvalid(false)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                const input = event.currentTarget;
                const email = input.value.trim();
                if (!email) return;
                if (!input.checkValidity()) return setInvalid(true);
                if (!known.has(email.toLowerCase())) add(email);
                input.value = '';
              }}
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-3"
            />
          </label>
        </li>
      </ul>
      {invalid && <p className="mt-2 px-1 text-[12px] text-danger">{t('settings.invalidEmail')}</p>}
      <p className="mt-3 px-1 text-[12px] text-fg-3">
        {snapshot.accounts.length === 0 ? t('guide.accounts.needOne') : t('guide.accounts.colors')}
      </p>
    </Step>
  );
}

function ResumesStep({ snapshot, go }: { snapshot: Snapshot; go: Go }) {
  const { t } = useI18n();
  const run = useRepository();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const upload = async (files: File[]) => {
    for (const file of files) {
      const problem = await resumeProblem(file);
      if (problem) {
        showToast({ message: t(`resumes.${problem}`, { file: file.name, size: formatSize(file.size) }) });
        continue;
      }
      setUploading(file.name);
      const id = await run((repo) => uploadResume(repo, file));
      setUploading(null);
      if (id) showToast({ message: t('resumes.added', { name: versionName(file.name) }) });
    }
  };

  return (
    <Step
      icon={<FileText className="size-6" />}
      title={t('guide.resumes.title')}
      body={t('guide.resumes.body')}
      footer={<Footer back={() => go(1)} skip={() => go(3)} next={() => go(3)} busy={uploading !== null} />}
    >
      {snapshot.resumes.length > 0 && (
        <ul className="mb-2.5 space-y-2">
          {snapshot.resumes.map((resume) => (
            <li key={resume.id} className="card flex min-h-14 items-center gap-3 py-2 pr-3 pl-3">
              <span
                aria-hidden="true"
                className="grid h-9 w-7 shrink-0 place-items-center rounded-[5px] bg-accent/12 text-[9px] font-bold text-accent"
              >
                PDF
              </span>
              <span className="min-w-0 flex-1">
                <input
                  key={resume.name}
                  defaultValue={resume.name}
                  aria-label={t('resumes.name')}
                  maxLength={60}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (!next) event.target.value = resume.name;
                    else if (next !== resume.name)
                      void run((repo) => repo.saveResume({ id: resume.id, name: next }));
                  }}
                  onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                  className="-ml-1.5 h-7 w-full min-w-0 rounded-[8px] bg-transparent px-1.5 text-[14px] font-semibold outline-none focus:bg-fill-2"
                />
                <span className="block truncate text-[12px] text-fg-3">
                  {resume.file
                    ? `${resume.file.name} · ${formatSize(resume.file.size)}`
                    : t('resumes.noFile')}
                </span>
              </span>
              {resume.file && (
                <span className="flex shrink-0 items-center gap-1 text-[12px] text-[var(--acc-green)]">
                  <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                  {t('guide.resumes.uploaded')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length) void upload(files);
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void upload([...event.dataTransfer.files]);
        }}
        className={clsx(
          'flex h-28 w-full flex-col items-center justify-center gap-1 rounded-[18px] border-2 border-dashed text-[14px] transition-colors',
          over ? 'border-accent bg-accent/10 text-accent' : 'border-hairline text-fg-2 hover:bg-fill',
        )}
      >
        {uploading ? (
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
        ) : (
          <FileUp className="size-5" aria-hidden="true" />
        )}
        <span>{uploading ? t('resumes.uploading') : t('guide.resumes.drop')}</span>
        <span className="text-[12px] text-fg-3">{t('resumes.limit')}</span>
      </button>
    </Step>
  );
}

function ExtensionStep({ go }: { go: Go }) {
  const { t } = useI18n();
  const extension = useExtension({ watch: true });
  const desktop = useMediaQuery('(min-width: 768px)');
  const installed = extension.state !== 'checking' && extension.state !== 'missing';
  const ready = extension.state === 'ready';

  const pill = ready
    ? { text: t('ext.ready'), color: 'var(--acc-green)' }
    : installed
      ? { text: t('setup.meta.noKey'), color: 'var(--acc-orange)' }
      : extension.state === 'checking'
        ? { text: t('ext.checking'), color: 'var(--acc-gray)' }
        : { text: t('guide.ext.notFound'), color: 'var(--acc-gray)' };

  return (
    <Step
      icon={<Puzzle className="size-6" />}
      aside={
        <span
          role="status"
          className="flex h-7 items-center gap-1.5 rounded-full bg-fill px-3 text-[12px] font-semibold"
        >
          <span className="size-2 rounded-full" style={{ background: pill.color }} />
          {pill.text}
        </span>
      }
      title={t('guide.ext.title')}
      body={t('guide.ext.body')}
      footer={
        <Footer back={() => go(2)} skip={() => go(5)} skipLabel={t('guide.ext.manual')} next={() => go(4)} />
      }
    >
      {!desktop && (
        <p className="mb-3 rounded-[14px] bg-fill px-3 py-2 text-[13px] text-fg-2">
          {t('guide.ext.desktop')}
        </p>
      )}
      <ol className="card divide-y divide-hairline overflow-hidden">
        <Row
          done={installed}
          current={!installed}
          title={t('guide.ext.install')}
          body={
            installed
              ? extension.version
                ? t('guide.ext.found', { version: extension.version })
                : t('guide.ext.foundOld')
              : t('guide.ext.notFound')
          }
        >
          {!installed && (
            <>
              <p className="mt-2 text-[12px] leading-relaxed text-fg-2">{t('guide.ext.steps')}</p>
              <Button className="mt-3" onClick={() => window.location.reload()}>
                {t('ext.reload')}
              </Button>
            </>
          )}
        </Row>
        <Row
          done={ready}
          current={installed && !ready}
          title={ready ? t('guide.ext.keyDone') : t('guide.ext.key')}
          body={t('guide.ext.keyBody')}
        >
          {installed && !ready && (
            <Button variant="primary" className="mt-3" onClick={openExtensionOptions}>
              {t('ext.openOptions')}
            </Button>
          )}
        </Row>
        <Row
          done={installed}
          current={false}
          title={t('guide.ext.connect')}
          body={installed ? t('guide.ext.connectBody') : ''}
        />
      </ol>
      <p className="mt-3 px-1 text-[12px] text-fg-3">{t('guide.ext.live')}</p>
    </Step>
  );
}

function Row({
  done,
  current,
  title,
  body,
  children,
}: {
  done: boolean;
  current: boolean;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 p-4">
      <span
        aria-hidden="true"
        className={clsx(
          'mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full',
          done
            ? 'bg-accent text-on-accent'
            : current
              ? 'border-2 border-fg'
              : 'border-[1.5px] border-fg-3/60',
        )}
      >
        {done && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold">{title}</span>
        {body && <span className="mt-0.5 block text-[12px] leading-relaxed text-fg-2">{body}</span>}
        {children}
      </span>
    </li>
  );
}

function ReadStep({ snapshot, go }: { snapshot: Snapshot; go: Go }) {
  const { data, isPending } = useProfile();
  return isPending ? null : (
    <Reader key={data?.updatedAt ?? 'new'} saved={data ?? null} snapshot={snapshot} go={go} />
  );
}

function Reader({ saved, snapshot, go }: { saved: SavedProfile | null; snapshot: Snapshot; go: Go }) {
  const { t } = useI18n();
  const run = useRepository();
  const queryClient = useQueryClient();
  const extension = useExtension();
  const lastResume = usePrefs((p) => p.lastUsed.resumeId);
  const stored = snapshot.resumes.filter((resume) => resume.file);
  const [pick, setPick] = useState<Id | null>(
    () => stored.find((resume) => resume.id === lastResume)?.id ?? stored[0]?.id ?? null,
  );
  const [phase, setPhase] = useState<'idle' | 'reading' | 'review' | 'saving'>('idle');
  const [facts, setFacts] = useState<ResumeFacts | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = saved?.profile ?? emptyProfile();
  const hasHistory = base.education.length > 0 || base.experience.length > 0;
  const chosen = stored.find((resume) => resume.id === pick) ?? null;
  const ready = extension.state === 'ready';

  const read = async (id: Id) => {
    setPhase('reading');
    setNotice(null);
    const file = await run((repo) => loadResumePdf(repo, id));
    if (!file) return setPhase('idle');
    try {
      setFacts(await readResumeWithExtension(file));
      setPhase('review');
    } catch (error) {
      setNotice(error instanceof ExtensionError ? extensionText(t, error) : String(error));
      setPhase('idle');
    }
  };

  const apply = async (parts: ResumeParts) => {
    if (!facts) return;
    const parsed = profileSchema.safeParse(applyResume(base, facts, parts));
    if (!parsed.success) {
      const noName = parsed.error.issues.some((issue) => issue.path[0] === 'name');
      setNotice(
        noName
          ? t('guide.read.noName')
          : parsed.error.issues.map((issue) => describeIssue(issue, t)).join(' '),
      );
      return;
    }
    setPhase('saving');
    const result = await run((repo) => repo.saveProfile(parsed.data));
    if (!result) return setPhase('review');
    queryClient.setQueryData(PROFILE_KEY, result);
    showToast({ message: t('profile.saved') });
    go(5);
  };

  const reviewing = (phase === 'review' || phase === 'saving') && facts !== null;
  // Idle with the extension ready, the main button reads the chosen resume. It's a model call, so it waits for a
  // click rather than starting by itself.
  const canStart = chosen !== null && ready && phase === 'idle';
  let content: ReactNode = null;
  if (stored.length === 0) content = <Notice>{t('guide.read.noResume')}</Notice>;
  else if (phase === 'reading')
    content = (
      <p className="flex items-center gap-2 text-[14px] text-fg-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        {t('guide.read.reading', { name: chosen?.name ?? '' })}
      </p>
    );
  else if (reviewing)
    content = (
      <>
        <p className="mb-3 flex items-center gap-2 text-[13px] text-fg-2">
          <CircleCheck className="size-4 shrink-0 text-[var(--acc-green)]" aria-hidden="true" />
          {t('guide.read.done', { name: chosen?.name ?? '' })}
        </p>
        <ResumeReview
          draft={base}
          facts={facts}
          onApply={(parts) => void apply(parts)}
          applyLabel={t('guide.read.apply')}
        />
      </>
    );
  else if (!ready)
    content = (
      <Notice>{extension.state === 'checking' ? t('ext.checking') : t('guide.read.needsExtension')}</Notice>
    );
  else if (hasHistory) content = <Notice>{t('guide.read.already')}</Notice>;

  return (
    <Step
      icon={<FileText className="size-6" />}
      title={t('guide.read.title')}
      wide={reviewing}
      footer={
        <Footer
          back={() => go(3)}
          skip={canStart ? () => go(5) : undefined}
          next={() => (canStart && chosen ? void read(chosen.id) : go(5))}
          nextLabel={canStart && chosen ? t('guide.read.start', { name: chosen.name }) : t('guide.next')}
          busy={phase === 'reading' || phase === 'saving'}
        />
      }
    >
      {stored.length > 1 && phase !== 'reading' && phase !== 'saving' && (
        <label className="mb-4 flex items-center gap-2 text-[13px] text-fg-2">
          {t('guide.read.other')}
          <select
            value={pick ?? ''}
            onChange={(event) => {
              setPick(event.target.value);
              if (ready) void read(event.target.value);
            }}
            className="h-8 rounded-[10px] bg-fill px-2 text-[13px] text-fg outline-none"
          >
            {stored.map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {content}
      {notice && <Notice tone="alert">{notice}</Notice>}
      <p className="mt-4 flex items-center gap-1.5 text-[12px] text-fg-3">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
        {t('guide.read.note')}
      </p>
      {!reviewing && (
        <Link
          to={PAGE_PATHS.profile}
          className="mt-2 inline-block text-[13px] text-fg-2 underline-offset-2 hover:underline"
        >
          {t('guide.read.manual')}
        </Link>
      )}
    </Step>
  );
}

function Notice({ tone, children }: { tone?: 'alert'; children: ReactNode }) {
  return (
    <p
      role={tone === 'alert' ? 'alert' : 'status'}
      className={clsx(
        'mt-2 rounded-[14px] px-3 py-2 text-[13px] first:mt-0',
        tone === 'alert' ? 'bg-danger/10 text-danger' : 'bg-fill text-fg-2',
      )}
    >
      {children}
    </p>
  );
}

function AuthorizationStep({ go }: { go: Go }) {
  const { data, isPending } = useProfile();
  return isPending ? null : <Answers key={data?.updatedAt ?? 'new'} saved={data ?? null} go={go} />;
}

/** The answers no resume holds, set by the owner: work authorization, a few preferences, EEO. Never sent to AI. */
function Answers({ saved, go }: { saved: SavedProfile | null; go: Go }) {
  const { t } = useI18n();
  const run = useRepository();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Profile>(() => saved?.profile ?? emptyProfile());
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Asked only when no resume gave it: a profile can't be saved without a name.
  const [askName] = useState(() => !draft.name.first || !draft.name.last);
  const update = (change: (profile: Profile) => Profile) => setDraft(change);
  const answers = (fields: Partial<Profile['answers']>) =>
    update((profile) => ({ ...profile, answers: { ...profile.answers, ...fields } }));

  const save = async () => {
    const parsed = profileSchema.safeParse(draft);
    if (!parsed.success) return setErrors(parsed.error.issues.map((issue) => describeIssue(issue, t)));
    setSaving(true);
    const result = await run((repo) => repo.saveProfile(parsed.data));
    setSaving(false);
    if (!result) return;
    queryClient.setQueryData(PROFILE_KEY, result);
    showToast({ message: t('profile.saved') });
    go(6);
  };

  return (
    <Step
      wide
      title={t('guide.auth.title')}
      body={t('guide.auth.body')}
      footer={
        <Footer
          back={() => go(4)}
          skip={() => go(6)}
          next={() => void save()}
          nextLabel={t('guide.auth.save')}
          busy={saving}
        />
      }
    >
      {errors.length > 0 && (
        <div role="alert" className="mb-4 rounded-[14px] bg-danger/10 px-3 py-2 text-[13px] text-danger">
          <p className="font-medium">{t('profile.invalid')}</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {askName && (
            <Group title={t('guide.auth.name')}>
              <Grid>
                <Text
                  label={t('profile.f.first')}
                  value={draft.name.first}
                  onChange={(first) =>
                    update((profile) => ({ ...profile, name: { ...profile.name, first } }))
                  }
                />
                <Text
                  label={t('profile.f.last')}
                  value={draft.name.last}
                  onChange={(last) => update((profile) => ({ ...profile, name: { ...profile.name, last } }))}
                />
              </Grid>
            </Group>
          )}
          <Group title={t('profile.s.auth')}>
            <SectionBody section="auth" draft={draft} update={update} />
          </Group>
          <Group title={t('guide.auth.preferences')}>
            <Grid>
              <Text
                label={t('profile.f.salary')}
                value={draft.answers.salary}
                placeholder="$140,000–160,000"
                onChange={(salary) => answers({ salary })}
              />
              <Text
                label={t('profile.f.earliestStart')}
                value={draft.answers.earliestStart}
                placeholder="Two weeks after an offer"
                onChange={(earliestStart) => answers({ earliestStart })}
              />
            </Grid>
            <Toggle
              label={t('profile.f.relocate')}
              checked={draft.answers.relocate}
              onChange={(relocate) => answers({ relocate })}
            />
            <Toggle
              label={t('profile.f.onsite')}
              checked={draft.answers.onsite}
              onChange={(onsite) => answers({ onsite })}
            />
          </Group>
        </div>
        <Group title={t('profile.s.eeo')}>
          <SectionBody section="eeo" draft={draft} update={update} />
        </Group>
      </div>
    </Step>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card space-y-2 p-4">
      <h2 className="mb-1 text-[14px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function DoneStep({ snapshot, onEnter }: { snapshot: Snapshot; onEnter: () => void }) {
  const { t } = useI18n();
  const extension = useExtension();
  const { data } = useProfile();
  const goal = usePrefs((p) => p.dailyGoal);
  const setup = usePrefs((p) => p.setup);
  const profile = data?.profile ?? emptyProfile();
  const score = completeness(profile);
  const resumes = snapshot.resumes.filter((resume) => resume.file).length;
  const extensionReady = extension.state === 'ready' || setup.extensionReady;

  const summary = [
    { ok: snapshot.accounts.length > 0, title: t('guide.done.accounts', { n: snapshot.accounts.length }) },
    { ok: resumes > 0, title: t('guide.done.resumes', { n: resumes }) },
    { ok: extensionReady, title: extensionReady ? t('guide.done.extension') : t('guide.done.noExtension') },
    {
      ok: missingItems(profile).length === 0,
      title: t('guide.done.profile', { n: score }),
      hint: missingItems(profile).length ? t('guide.done.profileHint') : undefined,
    },
  ];
  const how = [t('guide.done.how1'), t('guide.done.how2'), t('guide.done.how3')];

  return (
    <Step
      icon={
        <span className="grid size-13 place-items-center rounded-[16px] bg-accent text-on-accent">
          <Check className="size-6" strokeWidth={2.6} />
        </span>
      }
      title={t('guide.done.title')}
      wide
      footer={
        <>
          <label className="flex items-center gap-2 text-[13px] text-fg-2">
            {t('guide.done.goal')}
            <input
              type="number"
              min={1}
              max={500}
              defaultValue={goal ?? ''}
              aria-label={t('guide.done.goal')}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                updatePrefs({ dailyGoal: Number.isFinite(value) && value > 0 ? value : null });
              }}
              className="h-9 w-20 rounded-[10px] bg-fill px-2.5 text-[14px] text-fg outline-none focus:bg-fill-2"
            />
            {t('guide.done.goalUnit')}
          </label>
          <span className="flex-1" />
          <Button variant="primary" className="h-10 px-5 text-[14px]" onClick={onEnter}>
            {t('guide.done.enter')}
          </Button>
        </>
      }
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {summary.map((item) => (
          <li key={item.title} className="card flex items-start gap-2.5 px-3.5 py-3">
            {item.ok ? (
              <Check
                className="mt-0.5 size-4 shrink-0 text-[var(--acc-green)]"
                strokeWidth={3}
                aria-hidden="true"
              />
            ) : (
              <span
                aria-hidden="true"
                className="mx-1 mt-1.5 size-2 shrink-0 rounded-full bg-[var(--acc-orange)]"
              />
            )}
            <span>
              <span className="block text-[14px] font-semibold">{item.title}</span>
              {item.hint && <span className="block text-[12px] text-fg-2">{item.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
      <h2 className="mt-6 text-[14px] font-semibold">{t('guide.done.how')}</h2>
      <ol className="mt-2.5 grid gap-2 sm:grid-cols-3">
        {how.map((text, index) => (
          <li key={text} className="rounded-[16px] bg-fill p-3.5">
            <span className="grid size-6 place-items-center rounded-full bg-accent text-[12px] font-semibold text-on-accent">
              {index + 1}
            </span>
            <p className="mt-2 text-[13px] leading-relaxed">{text}</p>
          </li>
        ))}
      </ol>
    </Step>
  );
}
