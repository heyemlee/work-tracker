import { toIsoDate } from '@domain/dates';
import { findSamePosting, linkKey } from '@domain/postings';
import type { QuickAddInput } from '@domain/repository';
import { buildRows } from '@domain/rows';
import type { Snapshot } from '@domain/types';
import { browser } from 'wxt/browser';
import type { Answer, FrameHeld, FrameScan, Held, PlannedField, ScannedField } from '../model';
import type { H1bTable } from '../match/h1b';
import { matchReport } from '../match/report';
import { isDone, toFrame, type CapturedAnswer, type CardState, type ChecklistItem } from '../messages';
import { aiCandidates, draftCandidates, planForm } from '../plan';
import { fullName, missingItems, yearsOfExperience } from '../profile/profile';
import type { Profile } from '../profile/schema';
import type { RuleContext } from '../rules/context';
import { remember } from '../rules/memory';
import { resumeChoices } from '../resumes';
import {
  aiKey,
  finalsItem,
  getSettings,
  lastUsedItem,
  loggedItem,
  memoryItem,
  profileItem,
  snapshotsItem,
  type FormSnapshot,
} from '../storage';
import { answerFields, draftAnswer, NoApiKey, similarFinals } from './ai';
import { fillFrames, frameOf, readOptions, scanFrames } from './frames';
import { loadSnapshot, OutboxSignedOut, quickAddOrQueue, syncProfile, undoQuickAdd } from './outbox';
import { getSession, updateSession, type TabSession } from './session';

const today = () => toIsoDate(new Date());

let h1bTable: Promise<H1bTable | null> | null = null;
/** The bundled H-1B table, loaded once per service-worker lifetime. */
function loadH1b(): Promise<H1bTable | null> {
  h1bTable ??= fetch(browser.runtime.getURL('/h1b.json'))
    .then((response) => (response.ok ? (response.json() as Promise<H1bTable>) : null))
    .catch(() => null);
  return h1bTable;
}

type OutboxState = { snapshot: Snapshot | null; status: CardState['outbox'] };

async function outboxState(force = false): Promise<OutboxState> {
  try {
    return { snapshot: await loadSnapshot(force), status: 'connected' };
  } catch (error) {
    return { snapshot: null, status: error instanceof OutboxSignedOut ? 'signedOut' : 'unreachable' };
  }
}

/** Joins what the frames found: the form frame's fields and posting, the address bar's URL. */
function merge(scans: FrameScan[], previous: TabSession | null) {
  const forms = scans.filter((scan) => scan.isApplication);
  const withPosting =
    [...forms, ...scans].find((scan) => scan.posting?.title || scan.posting?.company) ?? scans[0] ?? null;
  let posting = withPosting?.posting ?? null;
  // Workday's apply pages don't repeat the posting: keep what the job page said.
  if (posting && previous?.posting && posting.url.startsWith(previous.posting.url)) {
    posting = {
      ...posting,
      title: posting.title ?? previous.posting.title,
      description: posting.description || previous.posting.description,
      location: posting.location ?? previous.posting.location,
    };
  }
  return {
    ats: forms[0]?.ats ?? withPosting?.ats ?? null,
    posting,
    hasForm: forms.length > 0,
    step: forms.find((scan) => scan.step)?.step ?? null,
    fields: forms.flatMap((scan) => scan.fields),
  };
}

function matchedJob(snapshot: Snapshot | null, session: Pick<TabSession, 'posting'>) {
  if (!snapshot || !session.posting?.company) return null;
  return (
    findSamePosting(
      buildRows(snapshot),
      session.posting.company,
      session.posting.title,
      session.posting.url,
    ) ?? null
  );
}

const STATUS_ORDER: Record<PlannedField['status'], number> = {
  confirm: 0,
  missing: 1,
  draft: 2,
  filled: 3,
  skipped: 4,
};

/**
 * A line of the list as its field was seen after the fill. Filled in by hand where the fill had put nothing, it's
 * done; emptied, it's the owner's to fill again, or left empty where the form doesn't ask for it. A field the fill
 * did fill keeps its standing (an answer to check stays one) and shows what it holds now.
 */
function follow(item: ChecklistItem, now: Held): ChecklistItem {
  if (now.filled)
    return isDone(item)
      ? { ...item, value: now.value ?? item.value }
      : { ...item, status: 'filled', value: now.value ?? null };
  // A box the fill left unticked is as it was left.
  if (!isDone(item) || item.value === 'unchecked') return item;
  return { ...item, status: item.required ? 'missing' : 'skipped', value: null };
}

/**
 * Every field of the form, what needs the owner first; within one standing, in the form's own order. Each as the
 * fill left it, or as the page was seen to hold since: the owner goes on by hand, and the list follows.
 */
function checklist(session: TabSession): ChecklistItem[] {
  const fields = new Map(session.fields.map((field) => [field.id, field]));
  return session.plan
    .map((entry) => {
      const field = fields.get(entry.fieldId);
      const result = session.results[entry.fieldId];
      const failed = entry.answer !== null && result !== undefined && !result.ok;
      const item: ChecklistItem = {
        fieldId: entry.fieldId,
        label: field?.label ?? '',
        // An answer the page refused is the owner's to fill.
        status: failed ? 'missing' : entry.status,
        note: failed ? (result?.error ?? entry.note) : entry.note,
        value: result?.value ?? null,
        required: field?.required ?? false,
        critical: entry.critical,
        source: entry.source,
        applied: result?.ok ?? false,
      };
      // Of a look at the page and the fill's own word on a field, the later one counts.
      const seen = session.held[frameOf(entry.fieldId)];
      const now = seen && seen.at >= (result?.at ?? 0) ? seen.fields[entry.fieldId] : undefined;
      return now ? follow(item, now) : item;
    })
    .sort(
      (a, b) => Number(b.critical) - Number(a.critical) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
    );
}

/** The card's view of a tab. */
export async function cardState(session: TabSession, outbox?: OutboxState): Promise<CardState> {
  const { snapshot, status } = outbox ?? (await outboxState());
  const [profile, resumes, settings, key] = await Promise.all([
    profileItem.getValue(),
    resumeChoices(snapshot),
    getSettings(),
    aiKey(),
  ]);
  const job = matchedJob(snapshot, session);
  const applied = new Set(job?.applications.map((application) => application.accountId) ?? []);
  const accounts = (snapshot?.accounts ?? []).map((account) => ({
    id: account.id,
    email: account.email || account.label,
    color: account.color,
    applied: applied.has(account.id),
  }));
  const otherApplied = [...applied].some((id) => id !== session.accountId);
  // The page may have been seen to change while the rest was read, and its list sent on its own (`pageHolds`): the
  // list here is of the tab as it is now, so that it never takes an older one's place on the card.
  const latest = (await getSession(session.tabId)) ?? session;
  return {
    phase: session.phase,
    ats: session.ats,
    posting: session.posting,
    hasForm: session.hasForm,
    step: session.step,
    outbox: status,
    profile: profile ? { name: fullName(profile).trim(), blanks: missingItems(profile).length } : null,
    accounts,
    accountId: session.accountId,
    resumes,
    resumeId: session.resumeId,
    match: session.match,
    duplicateHint:
      (session.ats === 'ashby' || session.ats === 'workday') &&
      otherApplied &&
      session.accountId !== null &&
      !applied.has(session.accountId),
    checklist: checklist(latest),
    logged: session.logged,
    saved: session.saved,
    tracked: job ? (job.applications.length > 0 ? 'applied' : 'saved') : null,
    ai: !settings.aiEnabled
      ? 'off'
      : !key
        ? 'noKey'
        : session.ai === 'off' || session.ai === 'noKey'
          ? 'ready'
          : session.ai,
    error: session.error,
  };
}

/** Sends the tab's card its new state; the card may not be there yet. */
export async function pushState(session: TabSession, outbox?: OutboxState): Promise<void> {
  try {
    await toFrame(session.tabId, 0, 'card:update', { state: await cardState(session, outbox) });
  } catch {
    // No card in the top frame (yet).
  }
}

/** Reads the tab: the posting, its form, the match check, which accounts applied. */
export async function readTab(tabId: number, url: string): Promise<CardState> {
  const previous = await getSession(tabId);
  // The profile is edited on Outbox: refresh the local copy alongside the page scan. Offline, the copy stands.
  const synced = syncProfile().catch(() => null);
  const [scans, outbox, profile, settings, last, h1b] = await Promise.all([
    scanFrames(tabId, null),
    outboxState(true),
    synced.then(() => profileItem.getValue()),
    getSettings(),
    lastUsedItem.getValue(),
    loadH1b(),
  ]);
  const resumes = await resumeChoices(outbox.snapshot);
  const found = merge(scans, previous);
  const job = matchedJob(outbox.snapshot, found);
  const applied = new Set(job?.applications.map((application) => application.accountId) ?? []);
  const accounts = outbox.snapshot?.accounts ?? [];
  const keepAccount =
    previous?.accountId && accounts.some((account) => account.id === previous.accountId)
      ? previous.accountId
      : null;
  const accountId =
    keepAccount ??
    (last.accountId &&
    accounts.some((account) => account.id === last.accountId) &&
    !applied.has(last.accountId)
      ? last.accountId
      : null) ??
    accounts.find((account) => !applied.has(account.id))?.id ??
    null;
  const offered = (id: string | null | undefined) => resumes.some((resume) => resume.id === id);
  const resumeId = offered(previous?.resumeId)
    ? (previous?.resumeId ?? null)
    : offered(last.resumeId)
      ? last.resumeId
      : (resumes[0]?.id ?? null);
  const match = found.posting
    ? matchReport({
        posting: found.posting,
        applicantYears: profile ? yearsOfExperience(profile, today()) : 0,
        snapshot: outbox.snapshot,
        h1b,
        today: today(),
        jobId: job?.job.id ?? null,
        sameCompanyLimit: settings.sameCompanyLimit,
      })
    : null;
  const session = await updateSession(tabId, url, (current) => {
    // Workday keeps one address across its steps: the step's name tells them apart.
    const samePage = current.url === url && current.step === found.step;
    // Another posting in this tab starts over; its confirmation page (same posting) keeps the log and its Undo.
    const samePosting = Boolean(
      current.posting && found.posting && linkKey(found.posting.url) === linkKey(current.posting.url),
    );
    return {
      url,
      ...found,
      jobId: job?.job.id ?? null,
      accountId,
      resumeId,
      match,
      // A new page (another Workday step) starts a fresh checklist.
      plan: samePage ? current.plan : [],
      results: samePage ? current.results : {},
      phase: samePage ? current.phase : 'idle',
      logged: samePosting ? current.logged : null,
      saved: samePosting ? current.saved : null,
      submittedAt: samePosting ? current.submittedAt : null,
      captured: samePosting ? current.captured : [],
      error: null,
    };
  });
  return cardState(session, outbox);
}

export async function select(
  tabId: number,
  url: string,
  change: { accountId?: string | null; resumeId?: string | null },
): Promise<CardState> {
  const session = await updateSession(tabId, url, () => change);
  const last = await lastUsedItem.getValue();
  await lastUsedItem.setValue({
    accountId: session.accountId ?? last.accountId,
    resumeId: session.resumeId ?? last.resumeId,
  });
  return cardState(session);
}

function contextFor(
  session: TabSession,
  profile: Profile,
  snapshot: Snapshot | null,
  outboxResumes: boolean,
): RuleContext {
  const account = snapshot?.accounts.find((item) => item.id === session.accountId);
  const company = session.posting?.company;
  const appliedBefore = Boolean(
    snapshot &&
    company &&
    buildRows(snapshot).some(
      (row) =>
        row.company.name.toLowerCase() === company.toLowerCase() &&
        row.job.id !== session.jobId &&
        row.applications.length > 0,
    ),
  );
  void outboxResumes;
  return {
    profile,
    email: account?.email ?? '',
    resumeId: session.resumeId,
    posting: session.posting,
    today: today(),
    appliedBefore,
  };
}

/** Fills the tab's form: rules first, into the page at once; then AI for what's left, as it arrives. */
export async function fill(tabId: number, url: string): Promise<CardState> {
  // What a fill needs of Outbox is asked for together, and once: the profile, which the owner may have edited there
  // since the last fill (offline, the last copy is used), and the accounts. Nothing below waits for Outbox again.
  const [, outbox] = await Promise.all([syncProfile().catch(() => undefined), outboxState()]);
  const profile = await profileItem.getValue();
  if (!profile) {
    const session = await updateSession(tabId, url, () => ({ error: 'profile' }));
    return cardState(session, outbox);
  }
  let session = await updateSession(tabId, url, () => ({ phase: 'reading', error: null }));
  await pushState(session, outbox);

  // Fresh handles: the page may have changed since it was read. Workday also needs its entries added first.
  const prepare =
    session.ats === 'workday'
      ? {
          experience: Math.min(profile.experience.length, 5),
          education: Math.min(profile.education.length, 3),
        }
      : null;
  const scans = await scanFrames(tabId, prepare);
  const found = merge(scans, session);
  const [memory, settings, key] = await Promise.all([memoryItem.getValue(), getSettings(), aiKey()]);
  session = await updateSession(tabId, url, () => ({ ...found, phase: 'filling' }));
  await pushState(session, outbox);
  const ctx = contextFor(session, profile, outbox.snapshot, true);
  const useAi = settings.aiEnabled && Boolean(key);
  // What AI wrote in an earlier fill, where the page still holds it as AI left it, keeps its line of the plan: it
  // isn't asked for again. The tab's plan is still the earlier fill's here.
  const written = new Map(
    session.plan
      .filter((entry) => entry.source === 'ai' && entry.answer)
      .map((entry) => [entry.fieldId, entry]),
  );
  const planFields = (fields: readonly ScannedField[]) =>
    planForm(fields, ctx, memory).map((entry, at) => {
      const kept = fields[at]?.drafted ? written.get(entry.fieldId) : undefined;
      if (kept) return kept;
      // Without AI, a free-text question is the owner's to write.
      return entry.status === 'draft' && !entry.answer && !useAi
        ? { ...entry, status: 'missing' as const }
        : entry;
    });
  let fields = session.fields;
  let plan = planFields(fields);
  const results = await fillFrames(tabId, plan);
  // An answer can bring up another question (Greenhouse asks for race once "Hispanic or Latino?" is answered): the
  // page is read again and what appeared is filled too, twice at most.
  for (let round = 0; round < 2; round++) {
    await new Promise((done) => setTimeout(done, 300));
    const current = merge(await scanFrames(tabId, null), session).fields;
    const known = new Set(fields.map((field) => field.id));
    const added = current.filter((field) => !known.has(field.id));
    if (added.length === 0) break;
    const more = planFields(added);
    Object.assign(results, await fillFrames(tabId, more));
    const planned = new Map([...plan, ...more].map((entry) => [entry.fieldId, entry]));
    fields = current;
    plan = current.flatMap((field) => planned.get(field.id) ?? []);
  }
  session = await updateSession(tabId, url, () => ({
    fields,
    plan,
    results,
    phase: useAi ? 'drafting' : 'done',
    ai: useAi ? 'busy' : settings.aiEnabled ? 'noKey' : 'off',
  }));
  await pushState(session, outbox);
  if (useAi) void runAi(tabId, url, ctx);
  return cardState(session, outbox);
}

async function applyAi(tabId: number, url: string, entries: PlannedField[]): Promise<TabSession> {
  const results = await fillFrames(tabId, entries);
  const session = await updateSession(tabId, url, (current) => ({
    plan: current.plan.map((entry) => entries.find((next) => next.fieldId === entry.fieldId) ?? entry),
    results: { ...current.results, ...results },
  }));
  await pushState(session);
  return session;
}

/** How many AI requests are out at once: an endpoint behind a proxy may turn a crowd away. */
const AI_AT_ONCE = 3;

/** Turns at the page, which takes one answer at a time: each task runs once the one asked before it is through. */
function oneAtATime(): <T>(task: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return (task) => {
    const turn = last.then(task);
    last = turn.catch(() => undefined);
    return turn;
  };
}

/**
 * Runs the tasks a few at a time rather than each after the last. One that failed in that company gets a second go
 * alone, once the rest are through: an endpoint that turned it away for the crowd takes it then. The first to fail
 * twice is thrown.
 */
async function together(tasks: (() => Promise<void>)[]): Promise<void> {
  const failed: (() => Promise<void>)[] = [];
  let next = 0;
  const lane = async () => {
    for (let task = tasks[next++]; task; task = tasks[next++]) {
      try {
        await task();
      } catch {
        failed.push(task);
      }
    }
  };
  await Promise.all(Array.from({ length: AI_AT_ONCE }, lane));
  for (const task of failed) await task();
}

/**
 * AI for the leftovers: unknown fields in one request, and a request per free-text draft. The requests go out
 * together, since each takes seconds; their answers go into the page one at a time, as they come back.
 */
async function runAi(tabId: number, url: string, ctx: RuleContext): Promise<void> {
  try {
    let session = (await getSession(tabId))!;
    const { fields, plan } = session;
    const finals = await finalsItem.getValue();
    const onPage = oneAtATime();

    const leftovers = async () => {
      const candidates = aiCandidates(fields, plan);
      const needOptions = candidates
        .filter((field) => field.kind === 'combobox' && field.options.length === 0)
        .map((field) => field.id);
      const options = needOptions.length ? await onPage(() => readOptions(tabId, needOptions)) : {};
      const questions = candidates.map((field) => ({
        ...field,
        options: options[field.id] ?? field.options,
      }));
      const answers = await answerFields(questions, ctx.profile, ctx.posting, ctx.today);
      if (answers.length === 0) return;
      const byId = new Map(questions.map((field) => [field.id, field]));
      const entries = answers.map((answer): PlannedField => {
        const field = byId.get(answer.id)!;
        const value: Answer =
          field.kind === 'multi'
            ? { type: 'choices', texts: answer.choices }
            : field.options.length
              ? { type: 'choice', want: { kind: 'like', texts: [answer.answer] }, option: answer.answer }
              : { type: 'text', text: answer.answer };
        return {
          fieldId: answer.id,
          status: 'draft',
          answer: value,
          source: 'ai',
          key: 'ai',
          note: answer.reason,
          critical: false,
        };
      });
      await onPage(() => applyAi(tabId, url, entries));
    };

    const drafts = draftCandidates(fields, plan).map((field) => async () => {
      const text = await draftAnswer(
        field,
        ctx.profile,
        ctx.posting,
        ctx.today,
        similarFinals(finals, field.label),
      );
      if (!text) return;
      const entry: PlannedField = {
        fieldId: field.id,
        status: 'draft',
        answer: { type: 'text', text },
        source: 'ai',
        key: plan.find((planned) => planned.fieldId === field.id)?.key ?? 'text',
        note: null,
        critical: false,
      };
      await onPage(() => applyAi(tabId, url, [entry]));
    });

    await together([leftovers, ...drafts]);
    session = await updateSession(tabId, url, () => ({ ai: 'ready', phase: 'done' }));
    await pushState(session);
  } catch (error) {
    const session = await updateSession(tabId, url, () => ({
      ai: error instanceof NoApiKey ? 'noKey' : 'failed',
      phase: 'done',
      error:
        error instanceof NoApiKey ? null : `ai: ${error instanceof Error ? error.message : String(error)}`,
    }));
    await pushState(session);
  }
}

/**
 * What a frame's fields hold now, as its content script saw once the page had changed: after a fill the owner goes
 * on by hand, and the card's list follows. Only the list is sent, so nothing here waits on Outbox.
 */
export async function pageHolds(tabId: number, url: string, frameId: number, held: FrameHeld): Promise<void> {
  const session = await updateSession(tabId, url, (current) =>
    // A look overtaken on its way isn't put over a later one.
    (current.held[frameId]?.at ?? 0) > held.at ? {} : { held: { ...current.held, [frameId]: held } },
  );
  if (session.plan.length === 0) return;
  try {
    await toFrame(tabId, 0, 'card:checklist', { checklist: checklist(session) });
  } catch {
    // No card in the top frame.
  }
}

const sameAnswer = (a: Answer | null, b: Answer) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What the owner typed where the rules had nothing, remembered for the same question next time; AI drafts they
 * rewrote, kept as examples of their voice. Work-authorization and EEO answers are never remembered.
 */
async function learn(session: TabSession, captured: CapturedAnswer[]): Promise<void> {
  const fields = new Map(session.fields.map((field) => [field.id, field]));
  const plan = new Map(session.plan.map((entry) => [entry.fieldId, entry]));
  let memory = await memoryItem.getValue();
  const finals = await finalsItem.getValue();
  const now = new Date().toISOString();
  for (const { fieldId, answer } of captured) {
    const field = fields.get(fieldId);
    const entry = plan.get(fieldId);
    if (!field || !entry || entry.critical || field.kind === 'file') continue;
    if (entry.key?.startsWith('auth.') || entry.key?.startsWith('eeo.') || entry.key === 'consent') continue;
    if (entry.key?.startsWith('text.') || (entry.source === 'ai' && field.kind === 'textarea')) {
      if (answer.type === 'text' && entry.answer?.type === 'text' && answer.text !== entry.answer.text) {
        finals.unshift({
          question: field.label,
          company: session.posting?.company ?? '',
          text: answer.text,
          at: now,
        });
      }
      continue;
    }
    if (entry.source === 'rule' && sameAnswer(entry.answer, answer)) continue;
    if (entry.source === 'rule' && entry.status === 'filled' && entry.answer) continue;
    memory = remember(memory, field, answer, now);
  }
  await memoryItem.setValue(memory);
  await finalsItem.setValue(finals.slice(0, 200));
}

export async function submitAttempt(tabId: number, url: string, captured: CapturedAnswer[]): Promise<void> {
  const session = await updateSession(tabId, url, () => ({
    submittedAt: new Date().toISOString(),
    captured,
  }));
  await learn(session, captured);
}

/** A confirmation page: log the application if this tab was filled and submitted recently. */
export async function submitConfirmed(tabId: number, url: string): Promise<void> {
  const session = await getSession(tabId);
  if (!session || session.plan.length === 0 || (session.logged && !session.logged.undone)) return;
  const recent = session.submittedAt !== null && Date.now() - Date.parse(session.submittedAt) < 15 * 60_000;
  const samePosting = session.posting !== null && url.startsWith(session.posting.url);
  if (!recent && !samePosting) return;
  await logApplication(tabId, url, false);
}

export async function logApplication(tabId: number, url: string, manual: boolean): Promise<CardState> {
  let session = (await getSession(tabId)) ?? (await updateSession(tabId, url, () => ({})));
  const posting = session.posting;
  if (!posting?.company) {
    session = await updateSession(tabId, url, () => ({ error: 'noCompany' }));
    return cardState(session);
  }
  const outbox = await outboxState(true);
  const job = matchedJob(outbox.snapshot, session);
  if (
    session.accountId &&
    job?.applications.some((application) => application.accountId === session.accountId)
  ) {
    session = await updateSession(tabId, url, () => ({ error: 'alreadyLogged' }));
    return cardState(session, outbox);
  }
  // A version deleted on Outbox since it was picked would make the log fail; offline, the pick stands.
  const resumeId =
    !outbox.snapshot || outbox.snapshot.resumes.some((resume) => resume.id === session.resumeId)
      ? session.resumeId
      : null;
  const input: QuickAddInput = {
    companyName: posting.company,
    title: job ? null : posting.title,
    url: posting.url,
    jobId: job?.job.id ?? null,
    accountIds: session.accountId ? [session.accountId] : [],
    channelId: session.ats === 'linkedin' ? 'ch_linkedin' : 'ch_company_site',
    resumeId,
    appliedAt: today(),
  };
  try {
    const result = await quickAddOrQueue(input);
    session = await updateSession(tabId, url, () => ({
      logged: result ? { result, undone: false, manual } : null,
      error: result ? null : 'queued',
      jobId: result?.jobId ?? session.jobId,
    }));
    if (result && input.accountIds.length > 0) await loggedItem.setValue(true);
  } catch {
    session = await updateSession(tabId, url, () => ({ error: 'signedOut' }));
  }
  await pushState(session);
  return cardState(session);
}

/**
 * Saves a posting for later: a job on Outbox with no applications, which shows as Saved there. A posting Outbox
 * already tracks isn't saved twice.
 */
export async function saveJob(tabId: number, url: string): Promise<CardState> {
  let session = (await getSession(tabId)) ?? (await updateSession(tabId, url, () => ({})));
  const posting = session.posting;
  if (!posting?.company) {
    session = await updateSession(tabId, url, () => ({ error: 'noCompany' }));
    return cardState(session);
  }
  const outbox = await outboxState(true);
  if (matchedJob(outbox.snapshot, session)) return cardState(session, outbox);
  const input: QuickAddInput = {
    companyName: posting.company,
    title: posting.title,
    url: posting.url,
    jobId: null,
    accountIds: [],
    channelId: null,
    resumeId: null,
    appliedAt: today(),
  };
  try {
    const result = await quickAddOrQueue(input);
    session = await updateSession(tabId, url, () => ({
      saved: result ? { result, undone: false } : null,
      error: result ? null : 'queued',
      jobId: result?.jobId ?? session.jobId,
    }));
  } catch {
    session = await updateSession(tabId, url, () => ({ error: 'signedOut' }));
  }
  await pushState(session);
  return cardState(session);
}

/** Takes back the card's last log, or else its save. */
export async function undo(tabId: number, url: string): Promise<CardState> {
  let session = await getSession(tabId);
  if (session?.logged && !session.logged.undone) {
    await undoQuickAdd(session.logged.result);
    session = await updateSession(tabId, url, (current) => ({
      logged: current.logged ? { ...current.logged, undone: true } : null,
    }));
  } else if (session?.saved && !session.saved.undone) {
    await undoQuickAdd(session.saved.result);
    session = await updateSession(tabId, url, (current) => ({
      saved: current.saved ? { ...current.saved, undone: true } : null,
    }));
  }
  return cardState(session ?? (await updateSession(tabId, url, () => ({}))));
}

/** The same form captured again: its page, its step and its questions. */
function sameForm(a: FormSnapshot, b: FormSnapshot): boolean {
  return (
    a.url === b.url &&
    a.step === b.step &&
    a.fields.length === b.fields.length &&
    a.fields.every((field, index) => field.label === b.fields[index]?.label)
  );
}

/**
 * "This page didn't fill right": saves each form frame's structure, without values. Pressed again on the same
 * form, the newer capture takes the older one's place.
 */
export async function snapshot(tabId: number): Promise<number> {
  const session = await getSession(tabId);
  if (!session) return 0;
  const frames = [...new Set(session.fields.map((field) => frameOf(field.id)))];
  const saved: FormSnapshot[] = [];
  for (const frameId of frames) {
    try {
      const shot = await toFrame(tabId, frameId, 'frame:snapshot', {
        plan: session.plan.filter((entry) => frameOf(entry.fieldId) === frameId),
      });
      if (shot)
        saved.push({
          ...shot,
          company: session.posting?.company ?? null,
          title: session.posting?.title ?? null,
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
        });
    } catch {
      // The frame is gone.
    }
  }
  if (saved.length) {
    const earlier = (await snapshotsItem.getValue()).filter(
      (old) => !saved.some((shot) => sameForm(shot, old)),
    );
    await snapshotsItem.setValue([...saved, ...earlier].slice(0, 50));
  }
  return saved.length;
}

export async function focus(tabId: number, fieldId: string): Promise<void> {
  try {
    await toFrame(tabId, frameOf(fieldId), 'frame:focus', { fieldId });
  } catch {
    // The frame is gone.
  }
}

export type { ScannedField };
