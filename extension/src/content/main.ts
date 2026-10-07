import { listen, toBackground, type CapturedAnswer, type FrameMessage } from '../messages';
import type { FrameScan, PlannedField } from '../model';
import { adapterFor } from './adapters';
import type { Handle } from './adapters/types';
import { applyAnswer, readAnswer, type Applied } from './apply';
import { sleep } from './dom';
import {
  attachedFile,
  controlsOf,
  extractFields,
  fieldIds,
  holdsPicks,
  isFilled,
  type Extraction,
} from './extract';
import { formSnapshot } from './snapshot';
import { watchSubmission } from './submit';
import { fileFromBase64, readComboboxOptions } from './widgets';

/** What a field the page filled holds, for the checklist. */
function shownValue(handle: Handle): string | undefined {
  if (handle.type === 'file') return attachedFile(handle.element) ?? undefined;
  const answer = readAnswer(handle);
  if (!answer) return undefined;
  switch (answer.type) {
    case 'text':
      return answer.text;
    case 'choice':
      return answer.option ?? undefined;
    case 'choices':
      return answer.texts.join(', ');
    case 'check':
      return answer.checked ? 'checked' : 'unchecked';
    default:
      return undefined;
  }
}

/**
 * The content script, in every frame it runs in: it reads the form, fills it when asked, and reports submissions.
 * The service worker holds the plan; this side only touches the page.
 */
export function startContent(): void {
  const adapter = adapterFor(location.href);
  const top = window === window.top;
  let extraction: Extraction | null = null;
  // A field keeps its id across reads of the page: fields that appear after filling are told apart as new.
  const ids = fieldIds();
  // Controls this script filled: filling again may redo them. Any other value in the form is the page's, and stays.
  const wrote = new WeakSet<Element>();
  const ours = (handle: Handle) => controlsOf(handle).some((element) => wrote.has(element));

  async function scan(
    frameId: number,
    prepare: { experience: number; education: number } | null,
  ): Promise<FrameScan> {
    const form = adapter.form(document);
    if (form && prepare && adapter.prepare && (await adapter.prepare(form, prepare))) await sleep(300);
    extraction = extractFields(adapter, document, frameId, ids);
    for (const field of extraction.fields) {
      const handle = extraction.handles.get(field.id);
      if (field.filled && handle && ours(handle)) field.filled = false;
    }
    return {
      frameId,
      ats: adapter.ats,
      isApplication: extraction.fields.length > 0,
      posting: adapter.posting(document, location.href),
      fields: extraction.fields,
      step: adapter.step?.(document) ?? null,
    };
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
    for (const entry of ordered) {
      const handle = extraction.handles.get(entry.fieldId);
      if (!handle || !entry.answer) continue;
      // What the page holds stays: a resume it parsed, a Workday profile, the owner's typing. The email doesn't: it
      // names the account applying.
      if (entry.key !== 'email' && !ours(handle) && (filled.has(entry.fieldId) || isFilled(handle))) {
        results[entry.fieldId] = { ok: true, value: shownValue(handle) };
        continue;
      }
      // Filling again redoes this script's own answers, except where a second pick wouldn't replace the first: a
      // multi-select would show both ("East Asian", then "South Asian" as the nearest option left).
      if (holdsPicks(handle)) {
        results[entry.fieldId] = { ok: true, value: shownValue(handle) };
        continue;
      }
      const before = shownValue(handle);
      results[entry.fieldId] = await applyAnswer(handle, entry.answer, loadResume);
      if (!results[entry.fieldId]?.ok) continue;
      for (const element of controlsOf(handle)) wrote.add(element);
      if (entry.answer.type === 'file')
        await sleep(adapter.ats === 'lever' || adapter.ats === 'ashby' ? 2500 : 300);
      // Filling a field again with what it holds changes nothing for the page to take in.
      if (adapter.settle && (!before || shownValue(handle) !== before)) await adapter.settle();
    }
    return results;
  }

  function capture(): CapturedAnswer[] {
    if (!extraction) return [];
    const answers: CapturedAnswer[] = [];
    for (const [fieldId, handle] of extraction.handles) {
      const answer = readAnswer(handle);
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
          for (const id of message.fieldIds) {
            const handle = extraction?.handles.get(id);
            if (handle?.type === 'combobox') options[id] = await readComboboxOptions(handle.element);
          }
          return options;
        }
        case 'frame:read':
          return capture().filter((answer) => message.fieldIds.includes(answer.fieldId));
        case 'frame:focus': {
          const anchor = extraction?.anchors.get(message.fieldId);
          if (!(anchor instanceof HTMLElement)) return false;
          anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  watchSubmission(
    adapter,
    document,
    () => void toBackground('submit:attempt', { answers: capture() }).catch(() => undefined),
    () => void toBackground('submit:confirmed', { url: location.href }).catch(() => undefined),
  );
}
