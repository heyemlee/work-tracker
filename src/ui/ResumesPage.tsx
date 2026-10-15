import clsx from 'clsx';
import {
  ExternalLink,
  FileText,
  FileUp,
  IdCard,
  LoaderCircle,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { resumeFileUrl } from '../data/httpRepository';
import { formatSize, loadResumePdf, resumeProblem, uploadResume } from '../data/resumes';
import { localRepository, useRepository } from '../data/store';
import { toIsoDate } from '../domain/dates';
import { breakdown, percent, type Share } from '../domain/insights';
import { versionName } from '../domain/resumes';
import type { Id, ResumeVersion, Snapshot } from '../domain/types';
import { useI18n } from '../i18n/context';
import { formatShortDate } from '../i18n/format';
import { usePrefs } from '../state/prefs';
import { navigate, PAGE_PATHS } from '../state/router';
import { showToast } from '../state/toasts';
import { Button, IconButton } from './primitives';

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

/** The resumes, on their own page: upload each version once, and every other part uses it. */
export function ResumesPage({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useI18n();
  const run = useRepository();
  const defaultId = usePrefs((p) => p.lastUsed.resumeId);
  const fileRef = useRef<HTMLInputElement>(null);
  // The version a picked file replaces; null adds new versions.
  const replacing = useRef<ResumeVersion | null>(null);
  const [busy, setBusy] = useState<Id | 'new' | null>(null);
  const [dragging, setDragging] = useState(false);
  // How often each version went out, and how many of those reached an OA.
  const shares = useMemo(
    () => new Map(breakdown(snapshot.applications, 'resumeId').map((share) => [share.key, share])),
    [snapshot.applications],
  );

  const upload = async (files: File[], replace: ResumeVersion | null) => {
    for (const file of files) {
      const problem = await resumeProblem(file);
      if (problem) {
        showToast({ message: t(`resumes.${problem}`, { file: file.name, size: formatSize(file.size) }) });
        continue;
      }
      setBusy(replace?.id ?? 'new');
      const id = await run((repo) => uploadResume(repo, file, replace?.id));
      setBusy(null);
      if (id)
        showToast({
          message: replace
            ? t('resumes.replaced', { name: replace.name })
            : t('resumes.added', { name: versionName(file.name) }),
        });
    }
  };

  // The whole window takes a dropped PDF: one dropped beside the list would otherwise open in Outbox's place. Enter and leave fire for every element crossed, so a count tells when the drag left the window.
  const dropped = useEffectEvent((files: File[]) => void upload(files, null));
  useEffect(() => {
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      dropped([...(event.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const pick = (replace: ResumeVersion | null) => {
    replacing.current = replace;
    if (fileRef.current) fileRef.current.multiple = replace === null;
    fileRef.current?.click();
  };

  const remove = (resume: ResumeVersion) => {
    const used = shares.get(resume.id)?.sent ?? 0;
    const question = used
      ? t('resumes.confirmDeleteUsed', { name: resume.name, n: used })
      : t('resumes.confirmDelete', { name: resume.name });
    if (window.confirm(question)) void run((repo) => repo.deleteResume(resume.id));
  };

  return (
    <main className="mx-auto w-full max-w-[1040px] px-4 pt-[100px] pb-32 sm:px-6 md:pb-24">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length) void upload(files, replacing.current);
        }}
      />
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{t('resumes.title')}</h1>
          <p className="mt-1 text-[14px] text-fg-2">{t('resumes.hint')}</p>
        </div>
        <Button variant="secondary" onClick={() => navigate(PAGE_PATHS.resumeTools)}>
          {t('nav.resumeTools')}
        </Button>
        {snapshot.resumes.length > 0 && (
          <Button variant="primary" onClick={() => pick(null)} disabled={busy === 'new'}>
            {busy === 'new' ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="size-3.5" aria-hidden="true" />
            )}
            {busy === 'new' ? t('resumes.uploading') : t('resumes.upload')}
          </Button>
        )}
      </header>

      <div className="mt-6">
        {snapshot.resumes.length === 0 ? (
          <button
            type="button"
            onClick={() => pick(null)}
            disabled={busy === 'new'}
            className="flex w-full flex-col items-center rounded-[22px] border-2 border-dashed border-hairline px-6 py-16 text-center transition-colors hover:bg-fill"
          >
            <span className="grid size-12 place-items-center rounded-full bg-fill">
              {busy === 'new' ? (
                <LoaderCircle className="size-6 animate-spin text-fg-2" aria-hidden="true" />
              ) : (
                <FileUp className="size-6 text-fg-2" aria-hidden="true" />
              )}
            </span>
            <span className="mt-3 text-[16px] font-semibold">
              {busy === 'new' ? t('resumes.uploading') : t('resumes.emptyTitle')}
            </span>
            <span className="mt-1 max-w-[380px] text-[13px] text-fg-2">{t('resumes.emptyBody')}</span>
            <span className="mt-2 text-[12px] text-fg-3">{t('resumes.limit')}</span>
          </button>
        ) : (
          <>
            <ul className="grid gap-3 sm:grid-cols-2">
              {snapshot.resumes.map((resume) => (
                <ResumeRow
                  key={resume.id}
                  resume={resume}
                  share={shares.get(resume.id) ?? null}
                  isDefault={resume.id === defaultId}
                  busy={busy === resume.id}
                  onRename={(name) => void run((repo) => repo.saveResume({ id: resume.id, name }))}
                  onUpload={() => pick(resume)}
                  onFillProfile={() =>
                    navigate(`${PAGE_PATHS.profile}?read=${encodeURIComponent(resume.id)}`)
                  }
                  onDelete={() => remove(resume)}
                />
              ))}
            </ul>
            <p className="mt-3 px-1 text-[12px] text-fg-3">{t('resumes.limit')}</p>
          </>
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-[28px] border-2 border-dashed border-accent bg-accent/10 text-[15px] font-semibold text-accent backdrop-blur-sm">
          {t('resumes.drop')}
        </div>
      )}
    </main>
  );
}

function ResumeRow({
  resume,
  share,
  isDefault,
  busy,
  onRename,
  onUpload,
  onFillProfile,
  onDelete,
}: {
  resume: ResumeVersion;
  share: Share | null;
  isDefault: boolean;
  busy: boolean;
  onRename: (name: string) => void;
  onUpload: () => void;
  onFillProfile: () => void;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();
  const { file } = resume;
  const details = file
    ? [
        file.name,
        formatSize(file.size),
        t('resumes.uploaded', { date: formatShortDate(toIsoDate(new Date(file.uploadedAt)), locale) }),
      ]
    : [t('resumes.noFile')];
  const rate = share ? percent(share.oa, share.sent) : null;
  const used =
    share && rate !== null
      ? t(share.sent === 1 ? 'resumes.statsOne' : 'resumes.stats', {
          n: share.sent,
          rate: `${rate.toFixed(rate > 0 && rate < 10 ? 1 : 0)}%`,
        })
      : null;

  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span
          className={clsx(
            'grid size-11 shrink-0 place-items-center rounded-[12px]',
            file ? 'bg-accent/12 text-accent' : 'bg-fill-2 text-fg-3',
          )}
        >
          {busy ? (
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <FileText className="size-5" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <input
              key={resume.name}
              defaultValue={resume.name}
              aria-label={t('resumes.name')}
              maxLength={60}
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (!next) event.target.value = resume.name;
                else if (next !== resume.name) onRename(next);
              }}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              className="-ml-1.5 h-7 w-full min-w-0 rounded-[8px] bg-transparent px-1.5 text-[16px] font-semibold outline-none focus:bg-fill-2"
            />
            {isDefault && (
              <span className="shrink-0 rounded-full bg-fill-2 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
                {t('resumes.default')}
              </span>
            )}
          </div>
          <p className={clsx('truncate text-[12px]', file ? 'text-fg-3' : 'text-accent')}>
            {details.join(' · ')}
          </p>
          {used && <p className="mt-1.5 text-[13px]">{used}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {file ? (
          <>
            <Button onClick={onFillProfile} title={t('resumes.fillHint')}>
              <IdCard className="size-4" aria-hidden="true" />
              {t('resumes.fill')}
            </Button>
            <OpenPdf resume={resume} />
            <IconButton label={t('resumes.replace')} onClick={onUpload} disabled={busy}>
              <RefreshCw className="size-4" />
            </IconButton>
          </>
        ) : (
          <Button onClick={onUpload} disabled={busy}>
            <Upload className="size-3.5" aria-hidden="true" />
            {t('resumes.addFile')}
          </Button>
        )}
        <IconButton
          label={t('resumes.delete')}
          onClick={onDelete}
          className="ml-auto text-fg-3 hover:text-danger"
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}

const iconLink =
  'grid size-9 shrink-0 place-items-center rounded-full text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg';

/** Opens the PDF in the browser's viewer: from the Worker, or from the browser in the offline prototype. */
function OpenPdf({ resume }: { resume: ResumeVersion }) {
  const { t } = useI18n();
  const run = useRepository();
  const label = t('resumes.open');
  if (!localRepository)
    return (
      <a
        href={`${resumeFileUrl(resume.id)}?v=${encodeURIComponent(resume.file?.uploadedAt ?? '')}`}
        target="_blank"
        rel="noopener"
        aria-label={label}
        title={label}
        className={iconLink}
      >
        <ExternalLink className="size-4" />
      </a>
    );
  const open = async () => {
    // Opened before the wait, so the browser counts it as the click's own window.
    const tab = window.open('', '_blank');
    const pdf = await run((repo) => loadResumePdf(repo, resume.id));
    if (pdf && tab) tab.location.href = URL.createObjectURL(pdf);
    else tab?.close();
  };
  return (
    <button type="button" onClick={() => void open()} aria-label={label} title={label} className={iconLink}>
      <ExternalLink className="size-4" />
    </button>
  );
}
