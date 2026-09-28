import { beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from './commands';
import { ConflictError, NotFoundError } from './errors';
import type { QuickAddInput, Repository } from './repository';

/** A clock that advances one second per reading, so timeline order is deterministic. */
export function tickingClock(start = Date.parse('2026-09-01T09:00:00Z')): Clock {
  let tick = 0;
  let id = 0;
  return {
    now: () => new Date(start + 1000 * tick++).toISOString(),
    newId: (prefix) => `${prefix}_${(id++).toString().padStart(4, '0')}`,
  };
}

/**
 * The behavior every Repository must share. Runs against the browser-local implementation and against D1, so
 * the prototype and the real backend can't drift apart.
 */
export function describeRepositoryContract(name: string, create: (clock: Clock) => Promise<Repository>) {
  describe(`${name} repository contract`, () => {
    let repo: Repository;
    let a: string;
    let b: string;

    const add = (input: Partial<QuickAddInput> = {}) =>
      repo.quickAdd({
        companyName: 'Northwind AI',
        title: 'Software Engineer, Agents',
        url: null,
        jobId: null,
        accountIds: [a],
        channelId: 'ch_company_site',
        resumeId: null,
        appliedAt: '2026-09-01',
        ...input,
      });

    beforeEach(async () => {
      repo = await create(tickingClock());
      a = await repo.saveAccount({ label: 'A', email: 'a@example.com', color: 'blue' });
      b = await repo.saveAccount({ label: 'B', email: 'b@example.com', color: 'purple' });
    });

    it('starts with only the built-in channels and the accounts it was given', async () => {
      const snapshot = await repo.load();
      expect(snapshot.jobs).toEqual([]);
      expect(snapshot.accounts.map((acc) => acc.label)).toEqual(['A', 'B']);
      expect(snapshot.channels.filter((c) => c.builtin).map((c) => c.id)).toContain('ch_referral');
    });

    describe('quickAdd', () => {
      it('creates the company, the job, and one application per account', async () => {
        const result = await add({ accountIds: [a, b] });
        const snapshot = await repo.load();
        expect(snapshot.companies.map((c) => c.name)).toEqual(['Northwind AI']);
        expect(snapshot.jobs).toHaveLength(1);
        expect(snapshot.applications.map((app) => [app.accountId, app.stage, app.rejected])).toEqual(
          expect.arrayContaining([
            [a, 'applied', false],
            [b, 'applied', false],
          ]),
        );
        expect(result.applicationIds).toHaveLength(2);
        const events = await repo.loadEvents(result.jobId);
        expect(events.map((e) => e.type)).toEqual(['applied', 'applied']);
      });

      it('saves a job without applications, and records that it was saved', async () => {
        const { jobId } = await add({ accountIds: [] });
        expect((await repo.load()).applications).toEqual([]);
        expect((await repo.loadEvents(jobId)).map((e) => e.type)).toEqual(['job_created']);
      });

      it('reuses a company regardless of case and legal suffix', async () => {
        await add();
        await add({ companyName: 'northwind ai, inc.', title: 'AI Engineer' });
        const snapshot = await repo.load();
        expect(snapshot.companies).toHaveLength(1);
        expect(snapshot.jobs).toHaveLength(2);
      });

      it('attaches only accounts that have not applied yet', async () => {
        const first = await add({ accountIds: [a] });
        const second = await add({ jobId: first.jobId, accountIds: [a, b] });
        expect(second.createdJobId).toBeNull();
        expect(second.applicationIds).toHaveLength(1);
        const applications = (await repo.load()).applications.filter((app) => app.jobId === first.jobId);
        expect(applications.map((app) => app.accountId).sort()).toEqual([a, b].sort());
      });

      it('stores the link on a new job', async () => {
        await add({ url: 'https://jobs.lever.co/northwind/1' });
        expect((await repo.load()).jobs[0]?.url).toBe('https://jobs.lever.co/northwind/1');
      });

      it('gives a link to an attached job that has none, but never replaces one', async () => {
        const { jobId } = await add();
        await add({ jobId, accountIds: [b], url: 'https://jobs.lever.co/northwind/1' });
        await add({ jobId, accountIds: [], url: 'https://jobs.lever.co/northwind/2' });
        expect((await repo.load()).jobs[0]?.url).toBe('https://jobs.lever.co/northwind/1');
      });

      it('rejects accounts it does not know', async () => {
        await expect(add({ accountIds: ['acc_missing'] })).rejects.toBeInstanceOf(NotFoundError);
      });

      it('can be undone', async () => {
        const result = await add({ accountIds: [a, b] });
        await repo.undoQuickAdd(result);
        const snapshot = await repo.load();
        expect(snapshot.jobs).toEqual([]);
        expect(snapshot.applications).toEqual([]);
        expect(snapshot.companies).toEqual([]);
      });

      it('keeps a company on undo when another job was added to it since', async () => {
        const first = await add();
        await add({ title: 'AI Engineer' });
        await repo.undoQuickAdd(first);
        const snapshot = await repo.load();
        expect(snapshot.companies).toHaveLength(1);
        expect(snapshot.jobs.map((j) => j.title)).toEqual(['AI Engineer']);
      });
    });

    describe('applications', () => {
      it('records stage changes on the timeline, and skips no-op changes', async () => {
        const { jobId, applicationIds } = await add();
        const [id = ''] = applicationIds;
        await repo.setStage(id, 'oa');
        await repo.setStage(id, 'oa');
        expect((await repo.load()).applications[0]?.stage).toBe('oa');
        const [latest] = await repo.loadEvents(jobId);
        expect(latest).toMatchObject({ type: 'stage_changed', from: 'applied', to: 'oa', accountId: a });
        expect(await repo.loadEvents(jobId)).toHaveLength(2);
      });

      it('marks rejection as a flag that keeps the stage', async () => {
        const { jobId, applicationIds } = await add();
        const [id = ''] = applicationIds;
        await repo.setStage(id, 'oa');
        await repo.setRejected(id, true);
        expect((await repo.load()).applications[0]).toMatchObject({ stage: 'oa', rejected: true });
        await repo.setRejected(id, false);
        expect((await repo.loadEvents(jobId)).map((e) => e.type)).toEqual([
          'unrejected',
          'rejected',
          'stage_changed',
          'applied',
        ]);
      });

      it('adds another account to a job once', async () => {
        const { jobId } = await add();
        await repo.addApplication({
          jobId,
          accountId: b,
          channelId: null,
          resumeId: null,
          appliedAt: '2026-09-02',
        });
        await expect(
          repo.addApplication({
            jobId,
            accountId: b,
            channelId: null,
            resumeId: null,
            appliedAt: '2026-09-02',
          }),
        ).rejects.toBeInstanceOf(ConflictError);
      });

      it('removes an application but keeps its history', async () => {
        const { jobId, applicationIds } = await add();
        await repo.removeApplication(applicationIds[0] ?? '');
        expect((await repo.load()).applications).toEqual([]);
        expect((await repo.loadEvents(jobId))[0]).toMatchObject({
          type: 'application_removed',
          accountId: a,
        });
      });

      it('updates channel, resume, and applied date', async () => {
        const resumeId = await repo.saveResume({ name: 'SDE-v3' });
        const { applicationIds } = await add();
        await repo.updateApplication(applicationIds[0] ?? '', {
          channelId: 'ch_referral',
          resumeId,
          appliedAt: '2026-08-30',
        });
        expect((await repo.load()).applications[0]).toMatchObject({
          channelId: 'ch_referral',
          resumeId,
          appliedAt: '2026-08-30',
        });
      });
    });

    describe('jobs', () => {
      it('updates title, link and notes', async () => {
        const { jobId } = await add({ url: 'https://jobs.lever.co/northwind/1' });
        await repo.updateJob(jobId, { title: null, url: null, notes: 'Referral from Sam' });
        expect((await repo.load()).jobs[0]).toMatchObject({
          title: null,
          url: null,
          notes: 'Referral from Sam',
        });
      });

      it('soft-deletes a job with its applications, and restores it', async () => {
        const { jobId } = await add({ accountIds: [a, b] });
        await repo.deleteJob(jobId);
        let snapshot = await repo.load();
        expect(snapshot.jobs).toEqual([]);
        expect(snapshot.applications).toEqual([]);
        await expect(repo.loadEvents(jobId)).rejects.toBeInstanceOf(NotFoundError);

        await repo.restoreJob(jobId);
        snapshot = await repo.load();
        expect(snapshot.jobs).toHaveLength(1);
        expect(snapshot.applications).toHaveLength(2);
      });
    });

    describe('settings', () => {
      it('refuses to delete an account that has applications', async () => {
        await add();
        await expect(repo.deleteAccount(a)).rejects.toBeInstanceOf(ConflictError);
        await repo.deleteAccount(b);
        expect((await repo.load()).accounts.map((acc) => acc.label)).toEqual(['A']);
      });

      it('renames accounts', async () => {
        await repo.saveAccount({ id: a, label: 'Main', email: 'main@example.com', color: 'green' });
        expect((await repo.load()).accounts[0]).toMatchObject({
          label: 'Main',
          email: 'main@example.com',
          color: 'green',
        });
      });

      it('clears references when a resume or custom channel is deleted', async () => {
        const resumeId = await repo.saveResume({ name: 'Agent-v2' });
        const channelId = await repo.saveChannel({ name: 'Hackathon' });
        await add({ resumeId, channelId });
        await repo.deleteResume(resumeId);
        await repo.deleteChannel(channelId);
        const snapshot = await repo.load();
        expect(snapshot.applications[0]).toMatchObject({ resumeId: null, channelId: null });
        expect(snapshot.resumes).toEqual([]);
        expect(snapshot.channels.every((c) => c.builtin)).toBe(true);
      });

      it('protects built-in channels', async () => {
        await expect(repo.deleteChannel('ch_linkedin')).rejects.toBeInstanceOf(ConflictError);
      });
    });
  });
}
