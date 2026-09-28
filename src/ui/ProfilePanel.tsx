import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronRight, FileText, LoaderCircle, Upload, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog, Popover } from 'radix-ui';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import {
  ExtensionError,
  readResumeWithExtension,
  useExtension,
  type ExtensionState,
} from '../data/extension';
import { formatSize, loadResumePdf, resumeProblem, uploadResume } from '../data/resumes';
import { PROFILE_KEY, useProfile, useRepository } from '../data/store';
import {
  applyResume,
  emptyProfile,
  missingItems,
  parseProfile,
  profileSchema,
  resumeAdditions,
  resumeContact,
  type Profile,
  type ResumeFacts,
  type ResumeParts,
  type SavedProfile,
} from '../domain/profile';
import { versionName } from '../domain/resumes';
import type { Id, ResumeVersion } from '../domain/types';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/messages';
import { showToast } from '../state/toasts';
import { useLiquidGlass } from './glass/useLiquidGlass';
import { Button, IconButton } from './primitives';
import { SectionBody } from './ProfileFields';
import { PROFILE_SECTIONS, SECTION_OF_MISSING, type ProfileSection } from './profileSections';

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface ProfilePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stored resume versions, to read one of them into the profile. */
  resumes: ResumeVersion[];
  /** A stored resume to read as soon as the panel opens. */
  readFirst: Id | null;
}

/** The autofill profile, in its own panel opened from the toolbar. Edited as a draft and saved as a whole. */
export function ProfilePanel({ open, onOpenChange, resumes, readFirst }: ProfilePanelProps) {
  const { t } = useI18n();
  const dirty = useRef(false);
  const change = (next: boolean) => {
    if (!next && dirty.current && !window.confirm(t('profile.discard'))) return;
    if (!next) dirty.current = false;
    onOpenChange(next);
  };

  return (
    <Dialog.Root open={open} onOpenChange={change}>
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
                  className="pointer-events-auto flex h-[min(880px,calc(100dvh-24px))] w-full max-w-[960px] min-w-0 rounded-[28px] outline-none"
                  initial={{ scale: 0.96, y: 8 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.97, y: 6, transition: { duration: 0.15 } }}
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
                >
                  <PanelBody
                    resumes={resumes}
                    readFirst={readFirst}
                    onDirty={(value) => {
                      dirty.current = value;
                    }}
                    onClose={() => change(false)}
                  />
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

interface EditorProps {
  resumes: ResumeVersion[];
  readFirst: Id | null;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
}

function PanelBody(props: EditorProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const glass = useLiquidGlass(paneRef, { radius: 28, bevel: 18 });
  const { data, isPending } = useProfile();
  return (
    <div
      ref={paneRef}
      style={glass.style}
      className="glass glass-strong flex min-h-0 w-full flex-col overflow-hidden rounded-[inherit]"
    >
      {glass.filter}
      {/* A save replaces the stored profile; the editor restarts from it. */}
      {!isPending && <Editor key={data?.updatedAt ?? 'new'} saved={data ?? null} {...props} />}
    </div>
  );
}

/** Why the extension can't read a resume right now, or why it couldn't. */
function extensionText(t: Translate, reason: ExtensionState | ExtensionError): string {
  if (reason instanceof ExtensionError) {
    return reason.code === 'failed'
      ? t('profile.ext.failed', { detail: reason.detail || reason.code })
      : t(`profile.ext.${reason.code}`);
  }
  if (reason === 'no-key' || reason === 'ai-off') return t(`profile.ext.${reason}`);
  return t('profile.ext.missing');
}

function Editor({
  saved,
  resumes,
  readFirst,
  onDirty,
  onClose,
}: EditorProps & { saved: SavedProfile | null }) {
  const { t, locale } = useI18n();
  const run = useRepository();
  const queryClient = useQueryClient();
  const extension = useExtension();
  const wide = useMediaQuery('(min-width: 768px)');
  const jsonRef = useRef<HTMLInputElement>(null);
  const resumeRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<ProfileSection, HTMLElement | null>>>({});
  const [draft, setDraft] = useState<Profile>(() => saved?.profile ?? emptyProfile());
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [review, setReview] = useState<ResumeFacts | null>(null);
  const [active, setActive] = useState<ProfileSection>('basics');

  const markDirty = (value: boolean) => {
    setDirty(value);
    onDirty(value);
  };
  const update = (change: (profile: Profile) => Profile) => {
    setDraft(change);
    markDirty(true);
  };

  const save = async () => {
    const parsed = profileSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => describeIssue(issue, t)));
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSaving(true);
    const result = await run((repo) => repo.saveProfile(parsed.data));
    setSaving(false);
    if (!result) return;
    setErrors([]);
    markDirty(false);
    showToast({ message: t('profile.saved') });
    queryClient.setQueryData(PROFILE_KEY, result);
  };

  const importJson = async (file: File) => {
    setNotice(null);
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      setErrors([t('profile.importInvalid'), file.name]);
      return;
    }
    const parsed = parseProfile(json);
    if (!parsed.ok) {
      setErrors([t('profile.importInvalid'), ...parsed.errors]);
      return;
    }
    setErrors([]);
    update(() => parsed.profile);
  };

  const readResume = async (file: File) => {
    setReading(true);
    setErrors([]);
    try {
      setReview(await readResumeWithExtension(file));
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setNotice(error instanceof ExtensionError ? extensionText(t, error) : String(error));
    } finally {
      setReading(false);
    }
  };

  /** Whether a resume can be read now; says why not when it can't. */
  const canRead = () => {
    setNotice(null);
    if (extension === 'ready') return true;
    setNotice(extensionText(t, extension));
    return false;
  };

  const readStored = async (id: Id) => {
    setReading(true);
    const file = await run((repo) => loadResumePdf(repo, id));
    if (file) await readResume(file);
    else setReading(false);
  };

  // A new PDF becomes a resume version too, so the extension can attach it.
  const uploadAndRead = async (file: File) => {
    const problem = await resumeProblem(file);
    if (problem) {
      setNotice(t(`resumes.${problem}`, { file: file.name, size: formatSize(file.size) }));
      return;
    }
    setReading(true);
    const id = await run((repo) => uploadResume(repo, file));
    if (!id) return setReading(false);
    showToast({ message: t('resumes.added', { name: versionName(file.name) }) });
    await readResume(file);
  };

  // Opened from the resumes panel: read that resume once the extension has answered.
  const started = useRef(false);
  const readFirstNow = useEffectEvent((id: Id) => {
    if (canRead()) void readStored(id);
  });
  useEffect(() => {
    if (!readFirst || started.current || extension === 'checking') return;
    started.current = true;
    readFirstNow(readFirst);
  }, [readFirst, extension]);

  const jump = (section: ProfileSection) => {
    const target = sectionRefs.current[section];
    scrollRef.current?.scrollTo({ top: (target?.offsetTop ?? 0) - 12, behavior: 'smooth' });
    setActive(section);
  };
  // The section list follows the scroll: the last section whose top has passed is the current one.
  const followScroll = () => {
    const container = scrollRef.current;
    if (!container || !wide) return;
    let current: ProfileSection = PROFILE_SECTIONS[0];
    for (const section of PROFILE_SECTIONS) {
      const element = sectionRefs.current[section];
      if (element && element.offsetTop - 24 <= container.scrollTop) current = section;
    }
    setActive(current);
  };

  const missing = missingItems(draft);
  const incomplete = new Set(missing.map((item) => SECTION_OF_MISSING[item]));
  const updated =
    saved &&
    new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(saved.updatedAt));
  const counts: Partial<Record<ProfileSection, number>> = {
    education: draft.education.length,
    experience: draft.experience.length,
  };
  const resumeIcon = reading ? (
    <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
  ) : (
    <FileText className="size-3.5" aria-hidden="true" />
  );

  return (
    <>
      <header className="flex items-center gap-1.5 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <Dialog.Title className="truncate text-[20px] font-semibold tracking-[-0.02em]">
            {t('profile.title')}
          </Dialog.Title>
          <p className="truncate text-[12px] text-fg-3">
            {updated ? t('profile.updated', { date: updated }) : t('profile.hint')}
          </p>
        </div>
        <input
          ref={resumeRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void uploadAndRead(file);
          }}
        />
        <input
          ref={jsonRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importJson(file);
          }}
        />
        <ResumeButton
          variant="ghost"
          resumes={resumes}
          disabled={reading}
          title={t('profile.fromResume')}
          canRead={canRead}
          onRead={(id) => void readStored(id)}
          onUpload={() => resumeRef.current?.click()}
        >
          {resumeIcon}
          <span className="max-sm:hidden">{reading ? t('profile.reading') : t('profile.fromResume')}</span>
        </ResumeButton>
        <Button variant="ghost" onClick={() => jsonRef.current?.click()} title={t('profile.import')}>
          <Upload className="size-3.5" aria-hidden="true" />
          <span className="max-sm:hidden">{t('profile.import')}</span>
        </Button>
        <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {t('profile.save')}
        </Button>
        <IconButton label={t('profile.close')} onClick={onClose} className="-mr-2">
          <X className="size-[18px]" />
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1">
        {wide && (
          <nav
            aria-label={t('profile.title')}
            className="w-[188px] shrink-0 space-y-0.5 overflow-y-auto px-3 pb-6"
          >
            {PROFILE_SECTIONS.map((section) => (
              <button
                key={section}
                type="button"
                onClick={() => jump(section)}
                aria-current={active === section ? 'true' : undefined}
                className={clsx(
                  'flex h-9 w-full items-center gap-2 rounded-[12px] px-3 text-left text-[14px] transition-colors',
                  active === section
                    ? 'bg-fill-2 font-medium text-fg'
                    : 'text-fg-2 hover:bg-fill hover:text-fg',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{t(`profile.s.${section}`)}</span>
                {incomplete.has(section) && (
                  <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                )}
              </button>
            ))}
          </nav>
        )}

        <div
          ref={scrollRef}
          onScroll={followScroll}
          className="scroll-area relative min-h-0 flex-1 space-y-3 px-5 pb-8 md:pl-2"
        >
          {!saved && !dirty && !review && (
            <div className="rounded-[18px] bg-fill p-4">
              <p className="text-[15px] font-semibold">{t('profile.startTitle')}</p>
              <p className="mt-1 text-[13px] text-fg-2">{t('profile.startBody')}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <ResumeButton
                  variant="primary"
                  resumes={resumes}
                  disabled={reading}
                  canRead={canRead}
                  onRead={(id) => void readStored(id)}
                  onUpload={() => resumeRef.current?.click()}
                >
                  {resumeIcon}
                  {reading
                    ? t('profile.reading')
                    : resumes.some((resume) => resume.file)
                      ? t('profile.startPick')
                      : t('profile.startUpload')}
                </ResumeButton>
                <span className="text-[12px] text-fg-3">{t('profile.startOr')}</span>
              </div>
              {!notice && (extension === 'missing' || extension === 'no-key' || extension === 'ai-off') && (
                <p className="mt-2 text-[12px] text-fg-3">{extensionText(t, extension)}</p>
              )}
            </div>
          )}

          {review && (
            <ResumeReview
              draft={draft}
              facts={review}
              onApply={(parts) => {
                update((profile) => applyResume(profile, review, parts));
                setReview(null);
              }}
              onCancel={() => setReview(null)}
            />
          )}

          {notice && (
            <p role="status" className="rounded-[14px] bg-fill px-3 py-2 text-[13px] text-fg-2">
              {notice}
            </p>
          )}

          {errors.length > 0 && (
            <div role="alert" className="rounded-[14px] bg-danger/10 px-3 py-2 text-[13px] text-danger">
              <p className="font-medium">
                {errors[0] === t('profile.importInvalid') ? errors[0] : t('profile.invalid')}
              </p>
              <ul className="mt-1 list-disc pl-5">
                {errors
                  .filter((error) => error !== t('profile.importInvalid'))
                  .map((error) => (
                    <li key={error}>{error}</li>
                  ))}
              </ul>
            </div>
          )}

          {missing.length > 0 && (
            <p className="px-1 text-[13px] text-fg-2">
              {t('profile.missing', {
                items: missing
                  .map((item) => t(`profile.missing.${item}` as MessageKey))
                  .join(locale === 'zh' ? '、' : ', '),
              })}
            </p>
          )}

          {PROFILE_SECTIONS.map((section) => (
            <Block
              key={section}
              wide={wide}
              title={t(`profile.s.${section}`)}
              count={counts[section]}
              missing={incomplete.has(section)}
              open={section === 'basics'}
              register={(element) => {
                sectionRefs.current[section] = element;
              }}
            >
              <SectionBody section={section} draft={draft} update={update} />
            </Block>
          ))}
        </div>
      </div>
    </>
  );
}

/** One section: a titled card on wide screens, where the list beside it jumps between them; collapsible on phones. */
function Block({
  wide,
  title,
  count,
  missing,
  open,
  register,
  children,
}: {
  wide: boolean;
  title: string;
  count?: number;
  missing: boolean;
  open: boolean;
  register: (element: HTMLElement | null) => void;
  children: ReactNode;
}) {
  if (wide) {
    return (
      <section ref={register}>
        <h3 className="mb-1.5 flex items-center gap-2 px-1 pt-1 text-[13px] font-semibold text-fg-2">
          {title}
          {count !== undefined && <span className="font-normal text-fg-3">{count}</span>}
        </h3>
        <div className="space-y-2 rounded-[18px] bg-fill/60 p-3.5">{children}</div>
      </section>
    );
  }
  return (
    <details ref={register} open={open} className="group rounded-[18px] bg-fill/60">
      <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-3.5 text-[14px] font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 text-fg-3 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        <span className="flex-1">{title}</span>
        {missing && <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />}
        {count !== undefined && <span className="text-[12px] text-fg-3">{count}</span>}
      </summary>
      <div className="space-y-2 px-3.5 pb-3.5">{children}</div>
    </details>
  );
}

/**
 * Reads a resume: picks one of the stored ones from a menu, or uploads a new PDF straight away when none is stored.
 */
function ResumeButton({
  resumes,
  canRead,
  onRead,
  onUpload,
  variant,
  disabled,
  title,
  children,
}: {
  resumes: ResumeVersion[];
  canRead: () => boolean;
  onRead: (id: Id) => void;
  onUpload: () => void;
  variant: 'primary' | 'ghost';
  disabled: boolean;
  title?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const stored = resumes.filter((resume) => resume.file);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  const option =
    'flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-[14px] transition-colors hover:bg-fill';

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <Button
          variant={variant}
          disabled={disabled}
          title={title}
          onClick={() => {
            if (!canRead()) return;
            if (stored.length) setOpen(true);
            else onUpload();
          }}
        >
          {children}
        </Button>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="glass glass-strong z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-[18px] p-1.5 outline-none data-[state=open]:animate-[pop-in_160ms_ease-out]"
        >
          <p className="px-2.5 pt-1.5 pb-1 text-[12px] font-medium text-fg-3">{t('profile.chooseResume')}</p>
          {stored.map((resume) => (
            <button
              key={resume.id}
              type="button"
              className={option}
              onClick={() => choose(() => onRead(resume.id))}
            >
              <FileText className="size-4 shrink-0 text-accent" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{resume.name}</span>
                <span className="block truncate text-[12px] text-fg-3">{resume.file?.name}</span>
              </span>
            </button>
          ))}
          <div className="mx-2 my-1 h-px bg-hairline" />
          <button type="button" className={clsx(option, 'text-fg-2')} onClick={() => choose(onUpload)}>
            <Upload className="size-4 shrink-0" aria-hidden="true" />
            {t('profile.uploadNew')}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const ALL_PARTS: ResumeParts = {
  contact: true,
  education: true,
  experience: true,
  skills: true,
  summary: true,
};

/** What a read resume would change, for the owner to pick from before it touches the draft. */
function ResumeReview({
  draft,
  facts,
  onApply,
  onCancel,
}: {
  draft: Profile;
  facts: ResumeFacts;
  onApply: (parts: ResumeParts) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [parts, setParts] = useState<ResumeParts>(ALL_PARTS);
  const span = (start: string, end: string) => (start || end ? `${start || '…'} – ${end || '…'}` : '');

  const rows: { part: keyof ResumeParts; label: string; lines: string[] }[] = [];
  const contact = resumeContact(draft, facts);
  if (contact.length)
    rows.push({
      part: 'contact',
      label: t('profile.review.contact'),
      lines: contact.map(({ field, value }) => `${t(`profile.f.${field}`)}: ${value}`),
    });
  const schools = facts.education.filter((school) => school.school);
  if (schools.length)
    rows.push({
      part: 'education',
      label: t('profile.review.education', { n: schools.length }),
      lines: schools.map((school) =>
        [
          school.school,
          [school.degree, school.field].filter(Boolean).join(' '),
          span(school.start, school.end),
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    });
  const jobs = facts.experience.filter((job) => job.company);
  if (jobs.length)
    rows.push({
      part: 'experience',
      label: t('profile.review.experience', { n: jobs.length }),
      lines: jobs.map((job) =>
        [job.company, job.title, span(job.start, job.end || t('profile.present'))]
          .filter(Boolean)
          .join(' · '),
      ),
    });
  const additions = [
    ...resumeAdditions(draft.skills, facts.skills),
    ...resumeAdditions(draft.languages, facts.languages),
  ];
  if (additions.length)
    rows.push({
      part: 'skills',
      label: t('profile.review.skills', { n: additions.length }),
      lines: [additions.join(', ')],
    });
  if (!draft.writing.summary.trim() && facts.summary)
    rows.push({ part: 'summary', label: t('profile.review.summary'), lines: [facts.summary] });

  const chosen = rows.some((row) => parts[row.part]);

  return (
    <section aria-label={t('profile.review.title')} className="rounded-[18px] bg-fill p-4">
      <p className="text-[15px] font-semibold">{t('profile.review.title')}</p>
      <p className="mt-0.5 text-[12px] text-fg-3">
        {rows.length ? t('profile.review.hint') : t('profile.review.nothing')}
      </p>
      <div className="mt-2 space-y-0.5">
        {rows.map((row) => (
          <label
            key={row.part}
            className="flex cursor-pointer gap-3 rounded-[12px] px-2 py-2 hover:bg-fill-2"
          >
            <input
              type="checkbox"
              checked={parts[row.part]}
              onChange={(event) => setParts({ ...parts, [row.part]: event.target.checked })}
              className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block text-[14px] font-medium">{row.label}</span>
              {row.lines.map((line) => (
                <span key={line} className="line-clamp-2 block text-[12px] text-fg-2">
                  {line}
                </span>
              ))}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onCancel}>{t('profile.review.cancel')}</Button>
        {rows.length > 0 && (
          <Button variant="primary" disabled={!chosen} onClick={() => onApply(parts)}>
            {t('profile.review.apply')}
          </Button>
        )}
      </div>
    </section>
  );
}

const ENTRY_FIELDS: Record<string, MessageKey> = { title: 'profile.f.jobTitle', text: 'profile.f.storyText' };

/** "Legal first name is required", "Work experience 2 · Start isn’t valid". */
function describeIssue(issue: { path: PropertyKey[]; code: string }, t: Translate) {
  const [section, second, third] = issue.path.map(String);
  const label = (key: string) => ENTRY_FIELDS[key] ?? (`profile.f.${key}` as MessageKey);
  let field: string;
  if ((section === 'education' || section === 'experience') && third)
    field = `${t(`profile.s.${section}`)} ${Number(second) + 1} · ${t(label(third))}`;
  else if (section === 'writing' && second === 'stories' && issue.path[3] !== undefined)
    field = `${t('profile.f.stories')} ${Number(third) + 1} · ${t(label(String(issue.path[3])))}`;
  else if (second && section !== 'education' && section !== 'experience') field = t(label(second));
  else field = issue.path.join('.');
  return t(issue.code === 'too_small' ? 'profile.required' : 'profile.badValue', { field });
}
