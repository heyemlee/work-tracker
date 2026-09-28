import { listen, toBackground, type CapturedAnswer, type FrameMessage } from '../messages';
import type { FrameScan, PlannedField } from '../model';
import { adapterFor } from './adapters';
import { applyAnswer, readAnswer, type Applied } from './apply';
import { sleep } from './dom';
import { extractFields, type Extraction } from './extract';
import { formSnapshot } from './snapshot';
import { watchSubmission } from './submit';
import { fileFromBase64, readComboboxOptions } from './widgets';

/**
 * The content script, in every frame it runs in: it reads the form, fills it when asked, and reports submissions.
 * The service worker holds the plan; this side only touches the page.
 */
export function startContent(): void {
  const adapter = adapterFor(location.href);
  const top = window === window.top;
  let extraction: Extraction | null = null;

  async function scan(
    frameId: number,
    prepare: { experience: number; education: number } | null,
  ): Promise<FrameScan> {
    const form = adapter.form(document);
    if (form && prepare && adapter.prepare && (await adapter.prepare(form, prepare))) await sleep(300);
    extraction = extractFields(adapter, document, frameId);
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
    // The resume goes first: Lever and Ashby parse it and fill fields of their own, which the profile then corrects.
    const ordered = [...fields].sort(
      (a, b) => Number(b.answer?.type === 'file') - Number(a.answer?.type === 'file'),
    );
    for (const entry of ordered) {
      const handle = extraction.handles.get(entry.fieldId);
      if (!handle || !entry.answer) continue;
      results[entry.fieldId] = await applyAnswer(handle, entry.answer, loadResume);
      if (entry.answer.type === 'file' && results[entry.fieldId]?.ok)
        await sleep(adapter.ats === 'lever' || adapter.ats === 'ashby' ? 2500 : 300);
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
