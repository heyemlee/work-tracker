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
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog } from 'radix-ui';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { resumeFileUrl } from '../data/httpRepository';
import { formatSize, loadResumePdf, resumeProblem, uploadResume } from '../data/resumes';
import { localRepository, useRepository } from '../data/store';
import { toIsoDate } from '../domain/dates';
import { versionName } from '../domain/resumes';
import type { Id, ResumeVersion, Snapshot } from '../domain/types';
import { useI18n } from '../i18n/context';
import { formatShortDate } from '../i18n/format';
import { showToast } from '../state/toasts';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { Button, IconButton } from './primitives';

interface ResumesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: Snapshot;
  /** Reads a stored resume into the autofill profile. */
  onFillProfile: (id: Id) => void;
}

/** The resumes, in their own panel from the toolbar: upload each version once, and every other part uses it. */
export function ResumesPanel({ open, onOpenChange, snapshot, onFillProfile }: ResumesPanelProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/20 dark:bg-black/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-3">
              <Dialog.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  className="pointer-events-auto flex max-h-[min(780px,calc(100dvh-24px))] w-full max-w-[640px] min-w-0 rounded-[28px] outline-none"
                  initial={{ scale: 0.96, y: 8 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.97, y: 6, transition: { duration: 0.15 } }}
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
                >
                  <PanelBody snapshot={snapshot} onFillProfile={onFillProfile} />
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

function PanelBody({ snapshot, onFillProfile }: Omit<ResumesPanelProps, 'open' | 'onOpenChange'>) {
  const { t } = useI18n();
  const run = useRepository();
  const paneRef = useRef<HTMLDivElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: 28, bevel: 18 });
  const fileRef = useRef<HTMLInputElement>(null);
  // The version a picked file replaces; null adds new versions.
  const replacing = useRef<ResumeVersion | null>(null);
  const [busy, setBusy] = useState<Id | 'new' | null>(null);
  const [dragging, setDragging] = useState(false);
  const uses = useMemo(() => {
    const counts = new Map<Id, number>();
    for (const { resumeId } of snapshot.applications)
      if (resumeId) counts.set(resumeId, (counts.get(resumeId) ?? 0) + 1);
    return counts;
  }, [snapshot.applications]);

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

  // While the panel is open the whole window takes a dropped PDF: one dropped beside the panel would otherwise open
  // in Outbox's place. Enter and leave fire for every element crossed, so a count tells when the drag left the window.
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
    const used = uses.get(resume.id) ?? 0;
    const question = used
      ? t('resumes.confirmDeleteUsed', { name: resume.name, n: used })
      : t('resumes.confirmDelete', { name: resume.name });
    if (window.confirm(question)) void run((repo) => repo.deleteResume(resume.id));
  };

  return (
    <div
      ref={paneRef}
      style={glass.style}
      className="glass glass-strong relative flex min-h-0 w-full flex-col overflow-hidden rounded-[inherit]"
    >
      {glass.filter}
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
      <header className="flex items-center gap-1.5 px-6 pt-5 pb-3">
        <div className="min-w-0 flex-1">
          <Dialog.Title className="text-[22px] font-semibold tracking-[-0.02em]">
            {t('resumes.title')}
          </Dialog.Title>
          <p className="text-[12px] text-fg-3">{t('resumes.hint')}</p>
        </div>
        {snapshot.resumes.length > 0 && (
          <Button variant="primary" onClick={() => pick(null)} disabled={busy === 'new'}>
            {busy === 'new' ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="size-3.5" aria-hidden="true" />
            )}
            <span className="max-sm:hidden">
              {busy === 'new' ? t('resumes.uploading') : t('resumes.upload')}
            </span>
          </Button>
        )}
        <Dialog.Close asChild>
          <IconButton label={t('resumes.close')} className="-mr-2">
            <X className="size-[18px]" />
          </IconButton>
        </Dialog.Close>
      </header>

      <div className="scroll-area min-h-0 flex-1 px-6 pt-1 pb-6">
        {snapshot.resumes.length === 0 ? (
          <button
            type="button"
            onClick={() => pick(null)}
            disabled={busy === 'new'}
            className="flex w-full flex-col items-center rounded-[22px] border-2 border-dashed border-hairline px-6 py-12 text-center transition-colors hover:bg-fill"
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
            <ul className="space-y-1.5">
              {snapshot.resumes.map((resume) => (
                <ResumeRow
                  key={resume.id}
                  resume={resume}
                  uses={uses.get(resume.id) ?? 0}
                  busy={busy === resume.id}
                  onRename={(name) => void run((repo) => repo.saveResume({ id: resume.id, name }))}
                  onUpload={() => pick(resume)}
                  onFillProfile={() => onFillProfile(resume.id)}
                  onDelete={() => remove(resume)}
                />
              ))}
            </ul>
            <p className="mt-3 px-1 text-[12px] text-fg-3">{t('resumes.limit')}</p>
          </>
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-[22px] border-2 border-dashed border-accent bg-accent/10 text-[15px] font-semibold text-accent">
          {t('resumes.drop')}
        </div>
      )}
    </div>
  );
}

function ResumeRow({
  resume,
  uses,
  busy,
  onRename,
  onUpload,
  onFillProfile,
  onDelete,
}: {
  resume: ResumeVersion;
  uses: number;
  busy: boolean;
  onRename: (name: string) => void;
  onUpload: () => void;
  onFillProfile: () => void;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();
  const { file } = resume;
  const details = [
    ...(file
      ? [
          file.name,
          formatSize(file.size),
          t('resumes.uploaded', { date: formatShortDate(toIsoDate(new Date(file.uploadedAt)), locale) }),
        ]
      : [t('resumes.noFile')]),
    ...(uses ? [uses === 1 ? t('resumes.usedOne') : t('resumes.usedMany', { n: uses })] : []),
  ];

  return (
    <li className="flex min-h-16 items-center gap-2 rounded-[18px] bg-fill py-2 pr-1.5 pl-2 sm:gap-3 sm:pl-3">
      <span
        className={clsx(
          'grid size-10 shrink-0 place-items-center rounded-[12px] max-sm:hidden',
          file ? 'bg-accent/12 text-accent' : 'bg-fill-2 text-fg-3',
        )}
      >
        {busy ? (
          <LoaderCircle className="size-[18px] animate-spin" aria-hidden="true" />
        ) : (
          <FileText className="size-[18px]" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
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
          className="-ml-1.5 h-7 w-full min-w-0 rounded-[8px] bg-transparent px-1.5 text-[15px] font-medium outline-none focus:bg-fill-2"
        />
        <p className={clsx('truncate text-[12px]', file ? 'text-fg-3' : 'text-accent')}>
          {details.join(' · ')}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        {file ? (
          <>
            <Button
              variant="ghost"
              onClick={onFillProfile}
              title={t('resumes.fillHint')}
              className="max-sm:px-2.5"
            >
              <IdCard className="size-4" aria-hidden="true" />
              <span className="max-sm:hidden">{t('resumes.fill')}</span>
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
        <IconButton label={t('resumes.delete')} onClick={onDelete} className="text-fg-3 hover:text-danger">
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
