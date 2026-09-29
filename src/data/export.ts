import { toCsv } from '../domain/csv';
import { toIsoDate } from '../domain/dates';
import type { Snapshot } from '../domain/types';

/** Downloads every application as a CSV file. */
export function downloadCsv(snapshot: Snapshot): void {
  // The BOM makes Excel read the file as UTF-8, which matters for non-Latin company names.
  const blob = new Blob(['\uFEFF', toCsv(snapshot)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `outbox-${toIsoDate(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
