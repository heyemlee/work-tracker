import { describe, expect, it } from 'vitest';
import { createLocalRepository } from '../data/localRepository';
import { saveDiscoveredPosting } from './discovery';
import { snapshot } from './testing';

const posting = { company: 'Example Labs', title: 'Engineer', url: 'https://jobs.lever.co/example/123' };
const repo = () => createLocalRepository({ storage: null, initial: () => ({ ...snapshot(), events: [] }) });

describe('saving discovered jobs', () => {
  it('uses the saved-only domain command, with no application or applied event', async () => {
    const store = repo();
    const result = await saveDiscoveredPosting(store, posting);
    expect((await store.load()).applications).toEqual([]);
    expect((await store.load()).jobs).toHaveLength(1);
    expect((await store.loadEvents(result.jobId)).map((event) => event.type)).toEqual(['job_created']);
  });
  it('deduplicates tracking variants, repeated visits and concurrent clicks', async () => {
    const store = repo();
    const [a, b] = await Promise.all([
      saveDiscoveredPosting(store, posting),
      saveDiscoveredPosting(store, { ...posting, url: `${posting.url}?utm_source=search` }),
    ]);
    expect(a.jobId).toBe(b.jobId);
    expect((await saveDiscoveredPosting(store, posting)).existing).toBe(true);
    expect((await store.load()).jobs).toHaveLength(1);
  });
  it('attaches a missing link to an existing saved job but keeps different postings separate', async () => {
    const store = repo();
    const old = await store.quickAdd({
      companyName: posting.company,
      title: posting.title,
      url: null,
      jobId: null,
      accountIds: [],
      channelId: null,
      resumeId: null,
      appliedAt: '2026-10-14',
    });
    expect((await saveDiscoveredPosting(store, posting)).jobId).toBe(old.jobId);
    expect((await store.load()).jobs[0]?.url).toBe(posting.url);
    await saveDiscoveredPosting(store, { ...posting, url: 'https://jobs.lever.co/example/456' });
    expect((await store.load()).jobs).toHaveLength(2);
    expect((await store.load()).applications).toHaveLength(0);
  });
  it('rejects non-web links without writing', async () => {
    const store = repo();
    await expect(saveDiscoveredPosting(store, { ...posting, url: 'javascript:alert(1)' })).rejects.toThrow();
    expect((await store.load()).jobs).toEqual([]);
  });
});
