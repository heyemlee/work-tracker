import type { Answer, Want } from '../model';
import { pickPlace } from '../rules/geo';
import { pickOption } from '../rules/options';
import { clean, findOption, norm } from '../text';
import type { Handle } from './adapters/types';
import { holdsChoice } from './adapters/workday';
import { sleep, textOf, waitFor } from './dom';
import { chipsOf, pickBox, pressed } from './extract';
import {
  clickLikeAPerson,
  closeCombobox,
  pickFromCombobox,
  pickFromTypeahead,
  setChecked,
  setFiles,
  setNativeValue,
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

/**
 * Which of the choices to pick, by its place among them: the one resolved while planning if it's still offered.
 * Where the choices stand as they were `read` and are only worded anew (a browser translating the page puts "亚裔"
 * where "Asian" stood), the one standing where the planned one was read: it is the same control. Else resolved
 * against what's there. -1 when none is.
 */
function choiceAt(texts: string[], want: Want, planned: string | null, read?: readonly string[]): number {
  if (planned !== null) {
    const still = texts.indexOf(planned);
    if (still >= 0) return still;
    const place = read?.length === texts.length ? read.indexOf(planned) : -1;
    if (place >= 0) return place;
    const same = texts.findIndex((text) => norm(text) === norm(planned));
    if (same >= 0) return same;
  }
  const picked = pickOption(texts, want);
  return picked === null ? -1 : texts.indexOf(picked);
}

/** The option to pick out of a list the page has just drawn: nothing was read of it before. */
function resolveChoice(texts: string[], want: Want, planned: string | null): string | null {
  return texts[choiceAt(texts, want, planned)] ?? null;
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

/**
 * Puts one answer into the page. `file` loads a resume PDF on demand; `read` is the field's choices as they were
 * worded when the page was read, for a page that words them otherwise by now.
 */
export async function applyAnswer(
  handle: Handle,
  answer: Answer,
  file: (resumeId: string) => Promise<File | null>,
  read?: readonly string[],
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
          const value =
            handle.dateFormat === 'month-name-year'
              ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
                  new Date(`${answer.iso.slice(0, 7)}-01T12:00:00Z`),
                )
              : formatDate(answer.iso, element);
          setText(element, value);
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
        const options = [...handle.element.options];
        const texts = options.map((option) => option.text.trim());
        if (handle.element.multiple && answer.type === 'choices') {
          const picked = answer.texts
            .map((text) => findOption(texts, [text]))
            .filter((text): text is string => text !== null);
          for (const option of handle.element.options) option.selected = picked.includes(option.text.trim());
          handle.element.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: picked.length > 0, value: picked.join(', ') };
        }
        const want = wantOf(answer);
        const at = want
          ? choiceAt(texts, want, answer.type === 'choice' ? answer.option : null, withPrompt(texts, read))
          : -1;
        const option = options[at];
        if (!option || !texts[at]) return { ok: false, error: 'no matching option' };
        setNativeValue(handle.element, option.value);
        return { ok: true, value: texts[at] };
      }

      case 'radio': {
        const labels = handle.labels ?? handle.inputs.map(choiceLabel);
        const want = wantOf(answer);
        const at = want ? choiceAt(labels, want, answer.type === 'choice' ? answer.option : null, read) : -1;
        const input = handle.inputs[at];
        if (!input) return { ok: false, error: 'no matching option' };
        setChecked(input, true);
        return { ok: true, value: labels[at] ?? '' };
      }

      case 'buttons': {
        const labels = handle.buttons.map((button) => textOf(button));
        const want = wantOf(answer);
        const at = want ? choiceAt(labels, want, answer.type === 'choice' ? answer.option : null, read) : -1;
        const button = handle.buttons[at];
        if (!button) return { ok: false, error: 'no matching option' };
        if (!pressed(button)) clickLikeAPerson(button);
        return { ok: true, value: labels[at] ?? '' };
      }

      case 'checkbox': {
        // A box is ticked by a yes and cleared by a no, and left as it is by some other text (a name meant for a name
        // field).
        if (answer.type === 'text' && !/^(yes|true|checked|no|false|unchecked)$/i.test(answer.text.trim()))
          return { ok: false, error: 'not a yes or no' };
        const checked =
          answer.type === 'check'
            ? answer.checked
            : answer.type === 'choice'
              ? answer.want.kind !== 'no' && answer.want.kind !== 'decline'
              : answer.type === 'choices'
                ? answer.texts.length > 0
                : answer.type === 'text'
                  ? /^(yes|true|checked)$/i.test(answer.text.trim())
                  : true;
        setChecked(handle.element, checked);
        return { ok: true, value: checked ? 'checked' : 'unchecked' };
      }

      case 'multi': {
        const labels = handle.inputs.map(choiceLabel);
        // An answer in its own words is looked for among the boxes as they read now, then as they were read.
        const among = (texts: readonly string[], text: string) => {
          const found = findOption(texts, [text]);
          return found === null ? -1 : texts.indexOf(found);
        };
        const then = read?.length === labels.length ? read : [];
        const wanted =
          answer.type === 'choices'
            ? answer.texts.map((text) => {
                const now = among(labels, text);
                return now >= 0 ? now : among(then, text);
              })
            : answer.type === 'choice'
              ? [choiceAt(labels, answer.want, answer.option, read)]
              : [];
        // "Select all that apply" gets the first match per wanted text, not every loose match.
        const unique = [...new Set(wanted.filter((at) => at >= 0))];
        if (unique.length === 0) return { ok: false, error: 'no matching option' };
        // The boxes that go are unticked before the ones that come are ticked: where a group takes one answer
        // (Workday's disability form), the page holds the other boxes disabled while one is ticked.
        handle.inputs.forEach((input, index) => {
          if (!unique.includes(index)) setChecked(input, false);
        });
        const open = unique.filter((at) => handle.inputs[at]?.disabled === false);
        if (open.length === 0) return { ok: false, error: 'the box can’t be ticked' };
        for (const at of open) setChecked(handle.inputs[at] as HTMLInputElement, true);
        // What the boxes hold now: a group that takes one answer shuts the rest as the first is ticked.
        const ticked = open.filter((at) => handle.inputs[at]?.checked);
        if (ticked.length === 0) return { ok: false, error: 'the box can’t be ticked' };
        return { ok: true, value: ticked.map((at) => labels[at]).join(', ') };
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
        if (handle.type === 'prompt' && handle.multiple) {
          const texts =
            answer.type === 'choices' ? answer.texts : answer.type === 'text' ? [answer.text] : [];
          if (!texts.length) return { ok: false, error: 'nothing to select' };
          for (const text of texts.slice(0, 20)) {
            if (handle.shown?.().some((value) => norm(value) === norm(text))) continue;
            const picked = await pickFromTypeahead(
              handle.element,
              text,
              (options) => options.find((option) => norm(option) === norm(text)) ?? null,
            );
            if (!picked) return { ok: false, error: 'no matching option' };
          }
          return { ok: true, value: (handle.shown?.() ?? texts).join(', ') };
        }
        const want = wantOf(answer);
        const query =
          answer.type === 'text'
            ? answer.text
            : answer.type === 'choice'
              ? (answer.option ?? (answer.want.kind === 'like' ? (answer.want.texts[0] ?? '') : ''))
              : answer.type === 'choices'
                ? (answer.texts[0] ?? '')
                : '';
        if (!want) return { ok: false, error: 'nothing to search for' };
        // A choice told by what it means, not by its words (a survey's "Decline to self identify"), in a dropdown
        // that searches as it's typed in (Ashby's longer lists): its whole list is opened and read.
        if (!query) {
          if (handle.type !== 'typeahead') return { ok: false, error: 'nothing to search for' };
          const choice = await pickFromCombobox(handle.element, (texts) => resolveChoice(texts, want, null));
          return choice ? { ok: true, value: choice } : { ok: false, error: 'no matching option' };
        }
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
        // Workday's form gets a date only as its field is left, and until then shows it in the field alone. The
        // field moves the focus among its parts itself: wherever it came to rest, it leaves from there.
        const parts: (Element | null)[] = [handle.month, handle.day, handle.year];
        const active = handle.year.ownerDocument.activeElement;
        if (active instanceof HTMLElement && parts.includes(active)) active.blur();
        return { ok: true, value: [month, handle.day ? day : null, year].filter(Boolean).join('/') };
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** A choice in the words it was `read` in, where the page words its choices otherwise by now. */
const asRead = (texts: readonly string[], at: number, read?: readonly string[]) =>
  (read?.length === texts.length ? read[at] : undefined) ?? texts[at] ?? '';

/** A list is read without the prompt it starts with: the reading, lined up with the list as it stands. */
const withPrompt = (texts: readonly string[], read?: readonly string[]) =>
  read && texts.length === read.length + 1 ? [texts[0] ?? '', ...read] : read;

/**
 * What a field holds now, as an answer: for remembering what the owner typed and for form snapshots. A choice is
 * told in the words it was `read` in.
 */
export function readAnswer(handle: Handle, read?: readonly string[]): Answer | null {
  switch (handle.type) {
    case 'input':
    case 'typeahead':
      return handle.element.value.trim() ? { type: 'text', text: handle.element.value.trim() } : null;
    case 'select': {
      const options = [...handle.element.options];
      const texts = options.map((option) => option.text.trim());
      const selected = [...handle.element.selectedOptions]
        .map((option) => asRead(texts, options.indexOf(option), withPrompt(texts, read)))
        .filter(Boolean);
      if (handle.element.multiple) return selected.length ? { type: 'choices', texts: selected } : null;
      return selected[0] && handle.element.selectedIndex > 0
        ? { type: 'choice', want: { kind: 'like', texts: [selected[0]] }, option: selected[0] }
        : null;
    }
    case 'radio': {
      const at = handle.inputs.findIndex((item) => item.checked);
      if (at < 0) return null;
      const label = asRead(handle.labels ?? handle.inputs.map(choiceLabel), at, read);
      return { type: 'choice', want: { kind: 'like', texts: [label] }, option: label };
    }
    case 'buttons': {
      const at = handle.buttons.findIndex(pressed);
      if (at < 0) return null;
      const label = asRead(
        handle.buttons.map((button) => textOf(button)),
        at,
        read,
      );
      return { type: 'choice', want: { kind: 'like', texts: [label] }, option: label };
    }
    case 'checkbox':
      return { type: 'check', checked: handle.element.checked };
    case 'multi': {
      const labels = handle.inputs.map(choiceLabel);
      const texts = handle.inputs.flatMap((input, at) => (input.checked ? [asRead(labels, at, read)] : []));
      return texts.length ? { type: 'choices', texts } : null;
    }
    case 'combobox': {
      if (handle.shown) {
        const value = handle.shown();
        return value ? { type: 'choice', want: { kind: 'like', texts: [value] }, option: value } : null;
      }
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
    case 'prompt': {
      const texts = handle.shown?.() ?? [];
      return texts.length ? { type: 'choices', texts } : null;
    }
    case 'file':
    case 'dateParts':
      return null;
  }
}
