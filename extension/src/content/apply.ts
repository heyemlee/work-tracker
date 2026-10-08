import type { Answer, Want } from '../model';
import { pickPlace } from '../rules/geo';
import { pickOption } from '../rules/options';
import { clean, findOption, norm } from '../text';
import type { Handle } from './adapters/types';
import { holdsChoice } from './adapters/workday';
import { sleep, textOf, waitFor } from './dom';
import { chipsOf, pickBox } from './extract';
import {
  clickLikeAPerson,
  closeCombobox,
  pickFromCombobox,
  pickFromTypeahead,
  setChecked,
  setFiles,
  setNativeValue,
  setSelect,
  setText,
} from './widgets';

export interface Applied {
  ok: boolean;
  /** What the field holds now, for the checklist. */
  value?: string;
  error?: string;
  /** When the fill left the field so, by the page's clock. */
  at?: number;
}

const choiceLabel = (input: HTMLInputElement) =>
  textOf(input.id ? input.ownerDocument.querySelector(`label[for="${input.id}"]`) : null) ||
  textOf(input.closest('label')) ||
  input.value;

/** The option to pick: the one resolved while planning if it's still offered, else resolved against what's there. */
function resolveChoice(texts: string[], want: Want, planned: string | null): string | null {
  if (planned !== null && texts.includes(planned)) return planned;
  if (planned !== null) {
    const same = texts.find((text) => norm(text) === norm(planned));
    if (same !== undefined) return same;
  }
  return pickOption(texts, want);
}

const wantOf = (answer: Answer): Want | null => {
  if (answer.type === 'choice') return answer.want;
  if (answer.type === 'text') return { kind: 'like', texts: [answer.text] };
  if (answer.type === 'check') return { kind: answer.checked ? 'yes' : 'no' };
  return null;
};

function formatDate(iso: string, input: HTMLInputElement): string {
  const [year = '', month = '', day = ''] = iso.split('-');
  if (input.type === 'date') return iso;
  if (input.type === 'month') return `${year}-${month}`;
  const hint = `${input.placeholder} ${input.getAttribute('aria-label') ?? ''}`.toLowerCase();
  if (/mm\s*\/\s*yyyy/.test(hint)) return `${month}/${year}`;
  if (/yyyy/.test(hint) && !/mm|dd/.test(hint)) return year;
  return `${month}/${day}/${year}`;
}

/** Puts one answer into the page. `file` loads a resume PDF on demand. */
export async function applyAnswer(
  handle: Handle,
  answer: Answer,
  file: (resumeId: string) => Promise<File | null>,
): Promise<Applied> {
  try {
    switch (handle.type) {
      case 'file': {
        if (answer.type !== 'file') return { ok: false, error: 'not a file answer' };
        const pdf = await file(answer.resumeId);
        if (!pdf) return { ok: false, error: 'resume not found' };
        setFiles(handle.element, [pdf]);
        // Where the page says what the upload holds, the file is in once the page shows it: Gem names it a moment
        // after its input changes. A file the page doesn't come to show, it didn't take.
        const { shown } = handle;
        if (shown && !(await waitFor(() => clean(shown() ?? '') === clean(pdf.name), 2000, 50, true)))
          return { ok: false, error: 'the page did not take the file' };
        return { ok: true, value: pdf.name };
      }

      case 'input': {
        const element = handle.element;
        if (answer.type === 'date' && element instanceof HTMLInputElement) {
          setText(element, formatDate(answer.iso, element));
          return { ok: true, value: element.value };
        }
        const text =
          answer.type === 'text'
            ? answer.text
            : answer.type === 'choice'
              ? (answer.option ?? '')
              : answer.type === 'choices'
                ? answer.texts.join(', ')
                : answer.type === 'check'
                  ? answer.checked
                    ? 'Yes'
                    : 'No'
                  : '';
        if (!text) return { ok: false, error: 'nothing to type' };
        setText(element, element.maxLength > 0 ? text.slice(0, element.maxLength) : text);
        return { ok: true, value: element.value };
      }

      case 'select': {
        const texts = [...handle.element.options].map((option) => option.text.trim());
        if (handle.element.multiple && answer.type === 'choices') {
          const picked = answer.texts
            .map((text) => findOption(texts, [text]))
            .filter((text): text is string => text !== null);
          for (const option of handle.element.options) option.selected = picked.includes(option.text.trim());
          handle.element.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: picked.length > 0, value: picked.join(', ') };
        }
        const want = wantOf(answer);
        const choice = want
          ? resolveChoice(texts, want, answer.type === 'choice' ? answer.option : null)
          : null;
        if (!choice || !setSelect(handle.element, choice)) return { ok: false, error: 'no matching option' };
        return { ok: true, value: choice };
      }

      case 'radio': {
        const labels = handle.inputs.map(choiceLabel);
        const want = wantOf(answer);
        const choice = want
          ? resolveChoice(labels, want, answer.type === 'choice' ? answer.option : null)
          : null;
        const input = choice === null ? undefined : handle.inputs[labels.indexOf(choice)];
        if (!input) return { ok: false, error: 'no matching option' };
        setChecked(input, true);
        return { ok: true, value: choice ?? '' };
      }

      case 'buttons': {
        const labels = handle.buttons.map((button) => textOf(button));
        const want = wantOf(answer);
        const choice = want
          ? resolveChoice(labels, want, answer.type === 'choice' ? answer.option : null)
          : null;
        const button = choice === null ? undefined : handle.buttons[labels.indexOf(choice)];
        if (!button) return { ok: false, error: 'no matching option' };
        if (button.getAttribute('aria-pressed') !== 'true') clickLikeAPerson(button);
        return { ok: true, value: choice ?? '' };
      }

      case 'checkbox': {
        const checked =
          answer.type === 'check'
            ? answer.checked
            : answer.type === 'choice'
              ? answer.want.kind !== 'no' && answer.want.kind !== 'decline'
              : answer.type === 'choices'
                ? answer.texts.length > 0
                : // A box is ticked by a yes, never by some other text (a name meant for a name field).
                  answer.type === 'text'
                  ? /^(yes|true|checked)$/i.test(answer.text.trim())
                  : true;
        setChecked(handle.element, checked);
        return { ok: true, value: checked ? 'checked' : 'unchecked' };
      }

      case 'multi': {
        const labels = handle.inputs.map(choiceLabel);
        const wanted =
          answer.type === 'choices'
            ? answer.texts
                .map((text) => findOption(labels, [text]))
                .filter((text): text is string => text !== null)
                .slice(0, answer.texts.length)
            : answer.type === 'choice'
              ? [resolveChoice(labels, answer.want, answer.option)].filter(
                  (text): text is string => text !== null,
                )
              : [];
        // "Select all that apply" gets the first match per wanted text, not every loose match.
        const unique = [...new Set(wanted)];
        if (unique.length === 0) return { ok: false, error: 'no matching option' };
        handle.inputs.forEach((input, index) => setChecked(input, unique.includes(labels[index] ?? '')));
        return { ok: true, value: unique.join(', ') };
      }

      case 'combobox': {
        const want = wantOf(answer);
        if (answer.type === 'choices') {
          const picked: string[] = [];
          for (const text of answer.texts.slice(0, 1)) {
            const choice = await pickFromCombobox(handle.element, (texts) => findOption(texts, [text]));
            if (choice) picked.push(choice);
          }
          return picked.length
            ? { ok: true, value: picked.join(', ') }
            : { ok: false, error: 'no matching option' };
        }
        if (!want) return { ok: false, error: 'not a choice' };
        const choice = await pickFromCombobox(handle.element, (texts) =>
          resolveChoice(texts, want, answer.type === 'choice' ? answer.option : null),
        );
        return choice ? { ok: true, value: choice } : { ok: false, error: 'no matching option' };
      }

      case 'typeahead':
      case 'prompt': {
        const want = wantOf(answer);
        const query =
          answer.type === 'text'
            ? answer.text
            : answer.type === 'choice'
              ? (answer.option ?? (answer.want.kind === 'like' ? (answer.want.texts[0] ?? '') : ''))
              : answer.type === 'choices'
                ? (answer.texts[0] ?? '')
                : '';
        if (!query || !want) return { ok: false, error: 'nothing to search for' };
        // Search by the most distinctive part: "Santa Clara, CA" finds "Santa Clara, California, United States", and
        // "United States of America (+1)" is searched without its dialing code.
        const bare = query.replace(/\s*\([^)]*\)/g, '').trim() || query;
        const search = handle.type === 'typeahead' ? (bare.split(',')[0] ?? bare) : bare;
        const starts = (texts: string[]) => texts.find((text) => norm(text).startsWith(norm(search))) ?? null;
        const choice = await pickFromTypeahead(
          handle.element,
          search,
          (texts) =>
            resolveChoice(texts, want, null) ??
            (handle.type === 'prompt'
              ? (starts(texts) ?? texts[0] ?? null)
              : // A city is told from its namesakes by its state; the first one listed may be in another country.
                search === bare
                ? starts(texts)
                : pickPlace(texts, bare)),
          handle.type === 'prompt',
        );
        if (choice) return { ok: true, value: choice };
        if (handle.type === 'prompt') return { ok: false, error: 'no suggestion' };
        // No suggestion fit. A plain text field keeps what was typed; a dropdown's search box holds only a pick, so it
        // is emptied again and left for the owner.
        if (handle.element.getAttribute('role') !== 'combobox')
          return { ok: true, value: handle.element.value };
        setNativeValue(handle.element, '');
        closeCombobox(handle.element);
        return { ok: false, error: 'no suggestion' };
      }

      case 'dateParts': {
        if (answer.type !== 'date') return { ok: false, error: 'not a date' };
        const [year = '', month = '', day = ''] = answer.iso.split('-');
        if (handle.month) setNativeValue(handle.month, month);
        if (handle.day) setNativeValue(handle.day, day);
        setNativeValue(handle.year, year);
        await sleep(20);
        return { ok: true, value: [month, handle.day ? day : null, year].filter(Boolean).join('/') };
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** What a field holds now, as an answer: for remembering what the owner typed and for form snapshots. */
export function readAnswer(handle: Handle): Answer | null {
  switch (handle.type) {
    case 'input':
    case 'typeahead':
      return handle.element.value.trim() ? { type: 'text', text: handle.element.value.trim() } : null;
    case 'select': {
      const selected = [...handle.element.selectedOptions]
        .map((option) => option.text.trim())
        .filter(Boolean);
      if (handle.element.multiple) return selected.length ? { type: 'choices', texts: selected } : null;
      return selected[0] && handle.element.selectedIndex > 0
        ? { type: 'choice', want: { kind: 'like', texts: [selected[0]] }, option: selected[0] }
        : null;
    }
    case 'radio': {
      const input = handle.inputs.find((item) => item.checked);
      if (!input) return null;
      const label = choiceLabel(input);
      return { type: 'choice', want: { kind: 'like', texts: [label] }, option: label };
    }
    case 'buttons': {
      const button = handle.buttons.find((item) => item.getAttribute('aria-pressed') === 'true');
      if (!button) return null;
      const label = textOf(button);
      return { type: 'choice', want: { kind: 'like', texts: [label] }, option: label };
    }
    case 'checkbox':
      return { type: 'check', checked: handle.element.checked };
    case 'multi': {
      const texts = handle.inputs.filter((input) => input.checked).map(choiceLabel);
      return texts.length ? { type: 'choices', texts } : null;
    }
    case 'combobox': {
      // Workday's dropdown button: its text is the prompt until something is chosen.
      if (handle.element.tagName === 'BUTTON' && !holdsChoice(handle.element)) return null;
      const container =
        pickBox(handle.element) ?? handle.element.closest('[data-automation-id^="formField-"]');
      const chips = chipsOf(handle.element);
      if (chips.length) return { type: 'choices', texts: chips };
      const shown =
        textOf(container?.querySelector('[class*="single-value"]')) ||
        (handle.element.tagName === 'BUTTON' ? textOf(handle.element) : '');
      return shown && !/select|choose/i.test(shown)
        ? { type: 'choice', want: { kind: 'like', texts: [shown] }, option: shown }
        : null;
    }
    case 'prompt':
    case 'file':
    case 'dateParts':
      return null;
  }
}
