import { listen, toBackground, type CapturedAnswer, type FrameMessage } from '../messages';
import type { Answer, FrameScan, Held, PlannedField } from '../model';
import { adapterFor } from './adapters';
import type { Handle } from './adapters/types';
import { applyAnswer, readAnswer, type Applied } from './apply';
import { sleep } from './dom';
import { controlsOf, extractFields, fieldIds, holdsPicks, isFilled, type Extraction } from './extract';
import { heldBy, shownValue, watchHeld } from './held';
import { formSnapshot } from './snapshot';
import { watchSubmission } from './submit';
import { fileFromBase64, readComboboxOptions } from './widgets';
import { holdTranslation, leaveUntranslated, ownWords } from './words';

/** How the page moves to a field: gliding, unless the owner's system asks for less motion. */
const glide = (): ScrollBehavior =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/** A field as the fill left it, and when: what the page is seen to hold later counts for more. */
const left = (applied: Applied): Applied => ({ ...applied, at: Date.now() });

/**
 * The content script, in every frame it runs in: it reads the form, fills it when asked, says what the form holds
 * as that changes, and reports submissions. The service worker holds the plan; this side only touches the page.
 * Returns a function that stops its watching of the page.
 */
export function startContent(): () => void {
  const adapter = adapterFor(location.href);
  const top = window === window.top;
  let extraction: Extraction | null = null;
  // A field keeps its id across reads of the page: fields that appear after filling are told apart as new.
  const ids = fieldIds();
  // What this script left in each control it filled. Filling again redoes its own answers, as long as they stand
  // as it left them. Any other value in the form stays: the page's, and the owner's, who may have put theirs in
  // place of this script's.
  const wrote = new WeakMap<Element, string | undefined>();
  // Remember the request as well as the displayed value: typeaheads can show a longer label than we asked for.
  const requested = new WeakMap<Element, string>();
  const ours = (handle: Handle) => {
    const control = controlsOf(handle).find((element) => wrote.has(element));
    return control !== undefined && wrote.get(control) === shownValue(handle);
  };
  // Two kinds of its own answers aren't redone while they stand. What AI wrote is written once: asking again costs
  // a request, and gives another answer in place of one the owner may have read and settled on.
  const byAi = new WeakSet<Element>();
  const drafted = (handle: Handle) => ours(handle) && controlsOf(handle).some((element) => byAi.has(element));
  // And a resume: put into the upload again, the site takes the file in again, and one that reads resumes reads it
  // again. It goes in anew when another is chosen on the card.
  const attached = new WeakMap<Element, string>();
  const sameResume = (handle: Handle, answer: Answer) =>
    handle.type === 'file' &&
    answer.type === 'file' &&
    ours(handle) &&
    attached.get(handle.element) === answer.resumeId;

  // The page's own words, for a page the browser translates: answers are planned on them, put in by them and
  // remembered in them. An applicant-tracking form is kept out of the translation from the turn it is drawn in;
  // on any other site finding the form takes a look over the whole page, so it is marked as it is read.
  const words = ownWords(document);
  const stopMarking =
    adapter.ats === 'generic' ? () => {} : leaveUntranslated(document, (doc) => adapter.form(doc));

  const unchanged = (handle: Handle, answer: Answer) =>
    handle.type !== 'file' &&
    shownValue(handle) !== undefined &&
    ours(handle) &&
    controlsOf(handle).every((element) => requested.get(element) === JSON.stringify(answer));

  // After a fill the owner goes on by hand: what each field holds is told as it changes, for the card's list. The
  // page is watched from the first form read on it, and a page without one never is.
  let held: ReturnType<typeof watchHeld> | null = null;
  const look = () => {
    if (!extraction || extraction.handles.size === 0) return null;
    const fields: Record<string, Held> = {};
    for (const [id, handle] of extraction.handles) {
      const now = heldBy(handle);
      if (now) fields[id] = now;
    }
    return fields;
  };
  const tell = (fields: Record<string, Held>) =>
    void toBackground('frame:held', { at: Date.now(), fields }).catch(() => undefined);

  async function scan(
    frameId: number,
    prepare: { experience: number; education: number } | null,
  ): Promise<FrameScan> {
    const form = adapter.form(document);
    form?.setAttribute('translate', 'no');
    if (form && prepare && adapter.prepare && (await adapter.prepare(form, prepare))) await sleep(300);
    extraction = extractFields(adapter, document, frameId, ids);
    const reading = {
      fields: extraction.fields,
      posting: adapter.posting(document, location.href),
      step: adapter.step?.(document) ?? null,
    };
    words.keep(reading);
    for (const field of extraction.fields) {
      const handle = extraction.handles.get(field.id);
      if (!field.filled || !handle || !ours(handle)) continue;
      // An answer of this script's own reads as open, for the next fill to redo; one AI wrote reads as kept.
      if (drafted(handle)) field.drafted = true;
      else field.filled = false;
    }
    if (extraction.fields.length > 0) held ??= watchHeld(document, look, tell);
    // A page read afresh may not be as the card last heard: loaded again, or changed by the page itself.
    held?.soon();
    return { frameId, ats: adapter.ats, isApplication: extraction.fields.length > 0, ...reading };
  }

  const loadResume = async (resumeId: string) => {
    const data = await toBackground('resume:read', { resumeId });
    return data ? fileFromBase64(data.base64, data.name, data.type) : null;
  };

  async function fill(fields: PlannedField[]): Promise<Record<string, Applied>> {
    const results: Record<string, Applied> = {};
    if (!extraction) return results;
    const filled = new Set(extraction.fields.filter((field) => field.filled).map((field) => field.id));
    // The resume goes first: Lever and Ashby parse it and fill fields of their own, which are then kept.
    const ordered = [...fields].sort(
      (a, b) => Number(b.answer?.type === 'file') - Number(a.answer?.type === 'file'),
    );
    // The fill's results say what it put where; the page is looked at again once it's through.
    held?.pause();
    // The lists it opens are read as the page words them.
    const letGo = holdTranslation(document);
    try {
      for (const entry of ordered) {
        const handle = extraction.handles.get(entry.fieldId);
        if (!handle || !entry.answer) continue;
        // What the page holds stays: a resume it parsed, a Workday profile, the owner's typing, their correction of
        // an answer of this script's. The email doesn't: it names the account applying.
        if (entry.key !== 'email' && !ours(handle) && (filled.has(entry.fieldId) || isFilled(handle))) {
          results[entry.fieldId] = left({ ok: true, value: shownValue(handle) });
          continue;
        }
        // Only redo changed requests. Reopening an unchanged dropdown needlessly searches and saves again. Keep
        // AI drafts and attached resumes too, and multi-select picks where a second pick would append to the first.
        if (
          drafted(handle) ||
          sameResume(handle, entry.answer) ||
          holdsPicks(handle) ||
          unchanged(handle, entry.answer)
        ) {
          results[entry.fieldId] = left({ ok: true, value: shownValue(handle) });
          continue;
        }
        // The page follows the fill, so the owner can watch each answer go in. The resume is attached out of turn,
        // and going to it would only jerk the page down and back.
        const anchor = extraction.anchors.get(entry.fieldId);
        if (entry.answer.type !== 'file') anchor?.scrollIntoView?.({ behavior: glide(), block: 'center' });
        const before = shownValue(handle);
        results[entry.fieldId] = left(
          await applyAnswer(handle, entry.answer, loadResume, words.choices(entry.fieldId)),
        );
        if (!results[entry.fieldId]?.ok) continue;
        const shown = shownValue(handle);
        for (const element of controlsOf(handle)) {
          wrote.set(element, shown);
          requested.set(element, JSON.stringify(entry.answer));
          if (entry.source === 'ai') byAi.add(element);
          else byAi.delete(element);
        }
        if (handle.type === 'file' && entry.answer.type === 'file')
          attached.set(handle.element, entry.answer.resumeId);
        if (entry.answer.type === 'file') await (adapter.resumeRead?.(document) ?? sleep(300));
        // Filling a field again with what it holds changes nothing for the page to take in.
        if (adapter.settle && (!before || shownValue(handle) !== before)) await adapter.settle();
      }
    } finally {
      letGo();
      held?.resume();
    }
    return results;
  }

  function capture(): CapturedAnswer[] {
    if (!extraction) return [];
    const answers: CapturedAnswer[] = [];
    for (const [fieldId, handle] of extraction.handles) {
      const answer = readAnswer(handle, words.choices(fieldId));
      if (answer) answers.push({ fieldId, answer });
    }
    return answers;
  }

  listen<FrameMessage>(
    async (message) => {
      switch (message.type) {
        case 'frame:scan':
          return scan(message.frameId, message.prepare);
        case 'frame:fill':
          return fill(message.fields);
        case 'frame:options': {
          const options: Record<string, string[]> = {};
          const letGo = holdTranslation(document);
          try {
            for (const id of message.fieldIds) {
              const handle = extraction?.handles.get(id);
              if (handle?.type === 'combobox') options[id] = await readComboboxOptions(handle.element);
            }
          } finally {
            letGo();
          }
          return options;
        }
        case 'frame:read':
          return capture().filter((answer) => message.fieldIds.includes(answer.fieldId));
        case 'frame:focus': {
          const anchor = extraction?.anchors.get(message.fieldId);
          if (!(anchor instanceof HTMLElement)) return false;
          anchor.scrollIntoView({ behavior: glide(), block: 'center' });
          const outline = anchor.style.outline;
          anchor.style.outline = '2px solid #3478f6';
          anchor.style.outlineOffset = '4px';
          setTimeout(() => {
            anchor.style.outline = outline;
          }, 1800);
          return true;
        }
        case 'frame:snapshot':
          return extraction ? formSnapshot(adapter, document, extraction, message.plan) : null;
        default:
          return undefined;
      }
    },
    (message) => typeof message.type === 'string' && message.type.startsWith('frame:'),
  );

  void toBackground('frame:hello', { ats: adapter.ats, hasForm: adapter.form(document) !== null, top }).catch(
    () => undefined,
  );

  // A page may say an application went through within a moment of its being sent. The service worker logs it by
  // the sending, so it is told of the confirmation once it has taken the sending in.
  let sent: Promise<unknown> = Promise.resolve();
  const stopSubmission = watchSubmission(
    adapter,
    document,
    (emails) => {
      sent = toBackground('submit:attempt', { answers: capture(), emails }).catch(() => undefined);
    },
    () => {
      const url = location.href;
      void sent.then(() => toBackground('submit:confirmed', { url })).catch(() => undefined);
    },
  );

  return () => {
    held?.stop();
    stopSubmission();
    stopMarking();
  };
}
