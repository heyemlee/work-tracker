import { indexBy } from './collections';
import { buildRows } from './rows';
import type { Snapshot } from './types';

const HEADER = [
  'company',
  'title',
  'url',
  'account',
  'email',
  'channel',
  'resume',
  'stage',
  'rejected',
  'applied_at',
  'notes',
];

function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * One line per application; saved jobs get one line with an empty account. Built-in channel names are exported
 * as their stable keys (e.g. `referral`) so the file doesn't depend on the UI language.
 */
export function toCsv(snapshot: Snapshot): string {
  const accounts = indexBy(snapshot.accounts, (a) => a.id);
  const channels = indexBy(snapshot.channels, (c) => c.id);
  const resumes = indexBy(snapshot.resumes, (r) => r.id);

  const lines = [HEADER];
  for (const row of buildRows(snapshot)) {
    const base = [row.company.name, row.job.title ?? '', row.job.url ?? ''];
    if (row.applications.length === 0) {
      lines.push([...base, '', '', '', '', 'saved', '', '', row.job.notes]);
      continue;
    }
    for (const app of row.applications) {
      const account = accounts.get(app.accountId);
      lines.push([
        ...base,
        account?.label ?? '',
        account?.email ?? '',
        (app.channelId && channels.get(app.channelId)?.name) || '',
        (app.resumeId && resumes.get(app.resumeId)?.name) || '',
        app.stage,
        app.rejected ? 'yes' : 'no',
        app.appliedAt,
        row.job.notes,
      ]);
    }
  }
  return lines.map((cells) => cells.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}
