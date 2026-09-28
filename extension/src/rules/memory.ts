import type { Answer, ScannedField } from '../model';
import { norm } from '../text';
import { isChoiceKind, isTextKind } from './resolve';

/** An answer the owner typed into a field the rules didn't fill, kept to fill the same question next time. */
export interface MemoryEntry {
  key: string;
  label: string;
  answer: Answer;
  uses: number;
  updatedAt: string;
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

export function recall(memory: readonly MemoryEntry[], field: ScannedField): MemoryEntry | null {
  const key = memoryKey(field);
  return memory.find((entry) => entry.key === key) ?? null;
}

/** Adds or replaces the entry for `field`, keeping the list bounded (least used, oldest first out). */
export function remember(
  memory: readonly MemoryEntry[],
  field: ScannedField,
  answer: Answer,
  now: string,
  limit = 500,
): MemoryEntry[] {
  const key = memoryKey(field);
  const previous = memory.find((entry) => entry.key === key);
  const entry: MemoryEntry = {
    key,
    label: field.label,
    answer,
    uses: (previous?.uses ?? 0) + 1,
    updatedAt: now,
  };
  const rest = memory.filter((item) => item.key !== key);
  const next = [entry, ...rest];
  if (next.length <= limit) return next;
  return [...next].sort((a, b) => b.uses - a.uses || b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}
