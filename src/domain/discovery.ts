import { cleanLink, findJobByLink, findSamePosting, linkKey } from './postings';
import type { Repository } from './repository';
import { buildRows } from './rows';
import type { Snapshot } from './types';

export interface DiscoveredPosting {
  company: string;
  title: string;
  url: string;
}

export function trackedPosting(snapshot: Snapshot, posting: DiscoveredPosting) {
  const rows = buildRows(snapshot);
  return (
    findJobByLink(rows, posting.url) ?? findSamePosting(rows, posting.company, posting.title, posting.url)
  );
}

// Rapid clicks on the same posting share a write; re-entry checks a fresh repository snapshot.
const writes = new WeakMap<Repository, Map<string, Promise<{ jobId: string; existing: boolean }>>>();
export function saveDiscoveredPosting(repo: Repository, posting: DiscoveredPosting) {
  const url = cleanLink(posting.url);
  if (!url) return Promise.reject(new Error('Invalid posting URL'));
  const key = linkKey(url);
  const pending = writes.get(repo) ?? new Map();
  writes.set(repo, pending);
  const previous = pending.get(key);
  if (previous) return previous;
  const operation = (async () => {
    const existing = trackedPosting(await repo.load(), { ...posting, url });
    if (existing) {
      if (!existing.job.url) await repo.updateJob(existing.job.id, { url });
      return { jobId: existing.job.id, existing: true };
    }
    const result = await repo.quickAdd({
      companyName: posting.company,
      title: posting.title,
      url,
      jobId: null,
      accountIds: [],
      channelId: null,
      resumeId: null,
      appliedAt: new Date().toISOString().slice(0, 10), // Unused without applications.
    });
    return { jobId: result.jobId, existing: false };
  })().finally(() => pending.delete(key));
  pending.set(key, operation);
  return operation;
}
