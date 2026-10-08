import type { Held } from '../model';
import type { Handle } from './adapters/types';
import { readAnswer } from './apply';
import { textOf } from './dom';
import { chipsOf, controlsOf, heldFile, isFilled } from './extract';

/**
 * What a field shows as its answer: for the checklist, and for telling an answer this script put in from one the
 * owner has since put in its place.
 */
export function shownValue(handle: Handle): string | undefined {
  if (handle.type === 'file') return heldFile(handle) ?? undefined;
  if (handle.type === 'combobox' || handle.type === 'typeahead') {
    const select = handle.element.closest('[class*="select__control"]');
    if (select) {
      // react-select shows a pick beside its search box; what's typed into the box isn't one yet.
      const chips = chipsOf(handle.element);
      const pick = chips.length ? chips.join(', ') : textOf(select.querySelector('[class*="single-value"]'));
      return pick || undefined;
    }
  }
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

/** react-select's signs of a field that holds a pick: the pick itself, or its value box saying it has one. */
const PICKED = '[class*="single-value"], [class*="multi-value"], [class*="value-container--has-value"]';

/** The checklist shows an answer on one line: no more of it need travel. */
const LINE = 120;

/**
 * What a field holds as the page stands, so the card's list can follow what the owner types, picks and clears after
 * a fill. Null where that can't be told: a control the page has since taken out, and an empty look on a widget that
 * draws its value in a way of its own, where a value this script doesn't see may be there all the same. Such a
 * field stays in the list as the fill left it.
 */
export function heldBy(handle: Handle): Held | null {
  if (!controlsOf(handle).every((control) => control.isConnected)) return null;
  // `sure`: an empty look is the field being empty.
  const held = (filled: boolean, value: string | undefined, sure: boolean): Held | null =>
    filled
      ? { filled, value: value && value.length > LINE ? `${value.slice(0, LINE)}…` : value }
      : sure
        ? { filled }
        : null;
  switch (handle.type) {
    case 'checkbox':
      // Ticked or not, a box says which: the list tells one the fill left unticked from one emptied since.
      return { filled: handle.element.checked, value: handle.element.checked ? 'checked' : 'unchecked' };
    case 'input':
    case 'select':
    case 'radio':
    case 'multi':
    case 'dateParts':
      return held(isFilled(handle), shownValue(handle), true);
    case 'combobox':
    case 'typeahead': {
      const select = handle.element.closest('[class*="select__control"]');
      // While something is typed into react-select's search box the pick isn't drawn, though the field holds it.
      if (select) return held(select.querySelector(PICKED) !== null, shownValue(handle), true);
      // Workday's dropdown button carries the chosen option's id as its value, empty while it prompts.
      if (handle.element.tagName === 'BUTTON' && handle.element.hasAttribute('value'))
        return held(handle.element.getAttribute('value') !== '', shownValue(handle), true);
      break;
    }
    case 'file':
      // Where the page itself says what the upload holds, its showing none is the upload being empty.
      if (handle.shown) return held(isFilled(handle), shownValue(handle), true);
      break;
    default:
      break;
  }
  return held(isFilled(handle) || readAnswer(handle) !== null, shownValue(handle), false);
}

/**
 * Tells `changed` what the form's fields hold, each time that has changed: the owner typed, picked or cleared
 * something, or the page did. `look` reads the fields, and answers null while there are none to read. The page is
 * looked at a moment after it changes, not on every change, and not between `pause` and `resume`: this script's
 * own filling goes between those, and tells of its answers itself.
 */
export function watchHeld(
  doc: Document,
  look: () => Record<string, Held> | null,
  changed: (fields: Record<string, Held>) => void,
  delay = 300,
): { soon(): void; pause(): void; resume(): void; stop(): void } {
  let told: string | null = null;
  let paused = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    timer = undefined;
    const fields = look();
    if (!fields) return;
    const now = JSON.stringify(fields);
    if (now === told) return;
    told = now;
    changed(fields);
  };
  const soon = () => {
    if (paused === 0 && !stopped) timer ??= setTimeout(check, delay);
  };
  // Typing changes a control's value without changing the document; a custom dropdown's pick does the reverse.
  const observer = new MutationObserver(soon);
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'value', 'aria-pressed', 'aria-checked'],
  });
  doc.addEventListener('input', soon, true);
  doc.addEventListener('change', soon, true);
  return {
    soon,
    pause() {
      paused++;
      clearTimeout(timer);
      timer = undefined;
    },
    resume() {
      paused = Math.max(0, paused - 1);
      soon();
    },
    stop() {
      stopped = true;
      observer.disconnect();
      doc.removeEventListener('input', soon, true);
      doc.removeEventListener('change', soon, true);
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
