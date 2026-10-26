import type { Answer, ScannedField } from '../model';
import { norm } from '../text';
import { isChoiceKind, isTextKind, onlyDate } from './resolve';

/** An answer the owner typed into a field the rules didn't fill, kept to fill the same question next time. */
export interface MemoryEntry {
  key: string;
  label: string;
  answer: Answer;
  uses: number;
  updatedAt: string;
  /** AI wrote it, and the owner sent it as it was: it's AI's answer still, to check, not the owner's. */
  byAi?: boolean;
}

/**
 * The same question in the same shape: label, the kind of field, and for choices the options on offer. A
 * remembered "Yes" never lands on a question whose options differ.
 */
export function memoryKey(field: Pick<ScannedField, 'label' | 'kind' | 'options'>): string {
  const shape = isTextKind(field.kind) ? 'text' : isChoiceKind(field.kind) ? 'choice' : field.kind;
  const options =
    isChoiceKind(field.kind) || field.kind === 'multi' ? field.options.map(norm).sort().join('/') : '';
  return `${norm(field.label)}|${shape}|${options}`;
}

/**
 * A field that says nothing of what it asks, or not whose: no label, or a date's words alone ("End date year", a
 * job's or a school's). Two such are not the same question, whatever they offer: Lyft's current job got an end year
 * typed on another form weeks before (2026-10-23).
 */
export const unnamed = (field: Pick<ScannedField, 'label'>) =>
  norm(field.label) === '' || onlyDate(field.label);

export function recall(memory: readonly MemoryEntry[], field: ScannedField): MemoryEntry | null {
  if (unnamed(field)) return null;
  const key = memoryKey(field);
  return memory.find((entry) => entry.key === key) ?? null;
}

/** Adds or replaces the entry for `field`, keeping the list bounded (least used, oldest first out). */
export function remember(
  memory: readonly MemoryEntry[],
  field: ScannedField,
  answer: Answer,
  now: string,
  { byAi = false, limit = 500 }: { byAi?: boolean; limit?: number } = {},
): MemoryEntry[] {
  if (unnamed(field)) return [...memory];
  const key = memoryKey(field);
  const previous = memory.find((entry) => entry.key === key);
  const entry: MemoryEntry = {
    key,
    label: field.label,
    answer,
    uses: (previous?.uses ?? 0) + 1,
    updatedAt: now,
    ...(byAi ? { byAi } : {}),
  };
  const rest = memory.filter((item) => item.key !== key);
  const next = [entry, ...rest];
  if (next.length <= limit) return next;
  return [...next].sort((a, b) => b.uses - a.uses || b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}
