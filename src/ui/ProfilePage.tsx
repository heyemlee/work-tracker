import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronRight, FileText, LoaderCircle, Upload } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { ExtensionError, readResumeWithExtension, useExtension } from '../data/extension';
import { formatSize, loadResumePdf, resumeProblem, uploadResume } from '../data/resumes';
import { PROFILE_KEY, useProfile, useRepository } from '../data/store';
import {
  applyResume,
  completeness,
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
import { navigate, PAGE_PATHS, setLeaveGuard } from '../state/router';
import { showToast } from '../state/toasts';
import { Button } from './primitives';
import { describeIssue, extensionText } from './profileText';
import { SectionBody } from './ProfileFields';
import { PROFILE_SECTIONS, SECTION_OF_MISSING, type ProfileSection } from './profileSections';

interface ProfilePageProps {
  /** The stored resume versions, to read one of them into the profile. */
  resumes: ResumeVersion[];
  /** A stored resume to read as soon as the page opens, from the resumes page. */
  readFirst: Id | null;
}

/** The profile the extension fills applications from, on its own page. Edited as a draft and saved as a whole. */
export function ProfilePage({ resumes, readFirst }: ProfilePageProps) {
  const { data, isPending } = useProfile();
  return (
    <main className="mx-auto w-full max-w-[1040px] px-4 pt-[100px] pb-32 sm:px-6 md:pb-24">
      {/* A save replaces the stored profile; the editor restarts from it. */}
      {!isPending && (
        <Editor key={data?.updatedAt ?? 'new'} saved={data ?? null} resumes={resumes} readFirst={readFirst} />
      )}
    </main>
  );
}

interface EditorProps {
  resumes: ResumeVersion[];
  readFirst: Id | null;
}

/** Room left above a section when jumping to it, for the floating toolbar. */
const TOOLBAR_CLEARANCE = 92;

function Editor({ saved, resumes, readFirst }: EditorProps & { saved: SavedProfile | null }) {
  const { t, locale } = useI18n();
  const run = useRepository();
  const queryClient = useQueryClient();
  const { state: extension } = useExtension();
  const wide = useMediaQuery('(min-width: 768px)');
  const jsonRef = useRef<HTMLInputElement>(null);
  const resumeRef = useRef<HTMLInputElement>(null);
  const sectionRefs = useRef<Partial<Record<ProfileSection, HTMLElement | null>>>({});
  const [draft, setDraft] = useState<Profile>(() => saved?.profile ?? emptyProfile());
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [review, setReview] = useState<ResumeFacts | null>(null);
  const [active, setActive] = useState<ProfileSection>('basics');

  const markDirty = (value: boolean) => setDirty(value);

  // Unsaved edits: leaving the page, or the tab, asks first.
  const leaveMessage = t('profile.leave');
  useEffect(() => {
    if (!dirty) return;
    setLeaveGuard(() => window.confirm(leaveMessage));
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty, leaveMessage]);
  const update = (change: (profile: Profile) => Profile) => {
    setDraft(change);
    markDirty(true);
  };

  const save = async () => {
    const parsed = profileSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => describeIssue(issue, t)));
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
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

  // Opened from the resumes page: read that resume once the extension has answered, then drop it from the address
  // so a reload doesn't read it again.
  const started = useRef(false);
  const readFirstNow = useEffectEvent((id: Id) => {
    navigate(PAGE_PATHS.profile, { replace: true });
    if (canRead()) void readStored(id);
  });
  useEffect(() => {
    if (!readFirst || started.current || extension === 'checking') return;
    started.current = true;
    readFirstNow(readFirst);
  }, [readFirst, extension]);

  const jump = (section: ProfileSection) => {
    const target = sectionRefs.current[section];
    if (target instanceof HTMLDetailsElement) target.open = true;
    const top = (target?.getBoundingClientRect().top ?? 0) + window.scrollY - TOOLBAR_CLEARANCE;
    window.scrollTo({ top, behavior: 'smooth' });
    setActive(section);
  };
  // The section list follows the scroll: the last section whose top has passed under the toolbar is the current one.
  useEffect(() => {
    if (!wide) return;
    const follow = () => {
      let current: ProfileSection = PROFILE_SECTIONS[0];
      for (const section of PROFILE_SECTIONS) {
        const element = sectionRefs.current[section];
        if (element && element.getBoundingClientRect().top <= TOOLBAR_CLEARANCE + 24) current = section;
      }
      setActive(current);
    };
    window.addEventListener('scroll', follow, { passive: true });
    return () => window.removeEventListener('scroll', follow);
  }, [wide]);

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
      <header className="flex flex-wrap items-end gap-x-3 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{t('profile.title')}</h1>
          <p className="mt-1 text-[14px] text-fg-2">
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
        <div className="flex items-center gap-1.5">
          <ResumeButton
            variant="secondary"
            resumes={resumes}
            disabled={reading}
            title={t('profile.fromResume')}
            canRead={canRead}
            onRead={(id) => void readStored(id)}
            onUpload={() => resumeRef.current?.click()}
          >
            {resumeIcon}
            {reading ? t('profile.reading') : t('profile.fromResume')}
          </ResumeButton>
          <Button variant="ghost" onClick={() => jsonRef.current?.click()} title={t('profile.import')}>
            <Upload className="size-3.5" aria-hidden="true" />
            <span className="max-sm:hidden">{t('profile.import')}</span>
          </Button>
          <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {t('profile.save')}
          </Button>
        </div>
      </header>

      <div className="mt-6 gap-6 md:grid md:grid-cols-[232px_minmax(0,1fr)] md:items-start">
        <aside className="space-y-3 md:sticky md:top-[92px]">
          <Completeness draft={draft} onJump={jump} />
          {wide && (
            <nav aria-label={t('profile.title')} className="card space-y-0.5 p-1.5">
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
                    <span className="size-1.5 shrink-0 rounded-full bg-[var(--st-oa)]" aria-hidden="true" />
                  )}
                </button>
              ))}
            </nav>
          )}
        </aside>

        <div className="mt-3 space-y-3 md:mt-0">
          {!saved && !dirty && !review && (
            <div className="card p-4">
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
            <p role="status" className="card px-4 py-3 text-[13px] text-fg-2">
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

          {PROFILE_SECTIONS.map((section) => (
            <Block
              key={section}
              wide={wide}
              title={t(`profile.s.${section}`)}
              count={counts[section]}
              missing={incomplete.has(section)}
              open={section === 'basics' || incomplete.has(section)}
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

/** The share of what forms ask that the profile answers, and each blank as a link to where it's filled in. */
function Completeness({ draft, onJump }: { draft: Profile; onJump: (section: ProfileSection) => void }) {
  const { t } = useI18n();
  const score = completeness(draft);
  const missing = missingItems(draft);
  const radius = 18;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 44 44" className="size-11 shrink-0 -rotate-90" aria-hidden="true">
          <circle cx="22" cy="22" r={radius} fill="none" strokeWidth="5" className="stroke-fill-2" />
          {score > 0 && (
            <circle
              cx="22"
              cy="22"
              r={radius}
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              className="stroke-accent transition-[stroke-dasharray] duration-500"
              strokeDasharray={`${(score / 100) * circumference} ${circumference}`}
            />
          )}
        </svg>
        <div className="min-w-0">
          <p className="text-[20px] font-semibold tracking-[-0.02em]">
            {t('profile.completeness', { n: score })}
          </p>
          <p className="text-[12px] text-fg-2">
            {missing.length ? t('profile.completenessHint', { n: missing.length }) : t('profile.complete')}
          </p>
        </div>
      </div>
      {missing.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {missing.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onJump(SECTION_OF_MISSING[item])}
              className="chip"
              data-status="oa"
            >
              {t(`profile.missing.${item}` as MessageKey)}
            </button>
          ))}
        </div>
      )}
    </div>
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
      <section ref={register} className="card scroll-mt-[92px] p-4">
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
          {title}
          {count !== undefined && <span className="font-normal text-fg-3">{count}</span>}
          {missing && <span className="size-1.5 rounded-full bg-[var(--st-oa)]" aria-hidden="true" />}
        </h2>
        <div className="space-y-2">{children}</div>
      </section>
    );
  }
  return (
    <details ref={register} open={open} className="card group">
      <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-3.5 text-[14px] font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 text-fg-3 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        <span className="flex-1">{title}</span>
        {missing && <span className="size-1.5 rounded-full bg-[var(--st-oa)]" aria-hidden="true" />}
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
  variant: 'primary' | 'secondary' | 'ghost';
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
export function ResumeReview({
  draft,
  facts,
  onApply,
  onCancel,
  applyLabel,
}: {
  draft: Profile;
  facts: ResumeFacts;
  onApply: (parts: ResumeParts) => void;
  /** Leaves the cancel button out, where the page has its own way on. */
  onCancel?: () => void;
  /** What the apply button says. */
  applyLabel?: string;
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
    <section aria-label={t('profile.review.title')} className="card p-4">
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
        {onCancel && <Button onClick={onCancel}>{t('profile.review.cancel')}</Button>}
        {rows.length > 0 && (
          <Button variant="primary" disabled={!chosen} onClick={() => onApply(parts)}>
            {applyLabel ?? t('profile.review.apply')}
          </Button>
        )}
      </div>
    </section>
  );
}
