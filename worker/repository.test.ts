import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError } from '../src/domain/errors';
import type { QuickAddInput } from '../src/domain/repository';
import { describeRepositoryContract } from '../src/domain/repository.contract';
import type { Db } from './db';
import { user } from './db/auth-schema';
import { createD1Repository } from './repository';
import { startTestDatabase } from './testing';

let db: Db;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, dispose } = await startTestDatabase());
}, 30_000);

afterAll(async () => {
  await dispose?.();
});

let users = 0;

/** Each repository gets its own user, so tests share one database without seeing each other's rows. */
async function newUser(): Promise<string> {
  const id = `user_${++users}`;
  await db.insert(user).values({ id, name: id, email: `${id}@example.com`, emailVerified: true });
  return id;
}

describeRepositoryContract('D1', async (clock) => {
  const userId = await newUser();
  // Tests share one database, so deterministic ids need a per-user suffix to stay unique.
  return createD1Repository(db, userId, {
    now: clock.now,
    newId: (prefix) => `${clock.newId(prefix)}_${userId}`,
  });
});

describe('D1 repository isolation', () => {
  const input = (accountId: string): QuickAddInput => ({
    companyName: 'Northwind AI',
    title: null,
    url: null,
    jobId: null,
    accountIds: [accountId],
    channelId: null,
    resumeId: null,
    appliedAt: '2026-09-01',
  });

  it('never shows or changes another user’s data', async () => {
    const alice = createD1Repository(db, await newUser());
    const bob = createD1Repository(db, await newUser());
    const aliceAccount = await alice.saveAccount({ label: 'A', email: '', color: 'blue' });
    const { jobId, applicationIds } = await alice.quickAdd(input(aliceAccount));
    const [applicationId = ''] = applicationIds;

    expect((await bob.load()).jobs).toEqual([]);
    await expect(bob.loadEvents(jobId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bob.setStage(applicationId, 'oa')).rejects.toBeInstanceOf(NotFoundError);
    await expect(bob.deleteJob(jobId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bob.quickAdd(input(aliceAccount))).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      bob.saveAccount({ id: aliceAccount, label: 'Taken', email: '', color: 'pink' }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect((await alice.load()).applications.map((a) => a.stage)).toEqual(['applied']);
  });

  it('keeps company names unique per user, not globally', async () => {
    const alice = createD1Repository(db, await newUser());
    const bob = createD1Repository(db, await newUser());
    await alice.quickAdd(input(await alice.saveAccount({ label: 'A', email: '', color: 'blue' })));
    await bob.quickAdd(input(await bob.saveAccount({ label: 'B', email: '', color: 'teal' })));
    expect((await bob.load()).companies.map((c) => c.name)).toEqual(['Northwind AI']);
  });
});
