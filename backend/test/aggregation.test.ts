import { afterEach, describe, expect, it, vi } from 'vitest';
import { Aggregation } from '../src/aggregation.js';
import type { Db } from '../src/db.js';

const HOUR = 60 * 60 * 1000;

/** A sync whose followed boards were last synced at `last`, with `start` stubbed out. */
function aggregation(followed: number, last: Date | null) {
  const db = { $queryRaw: vi.fn().mockResolvedValue([{ followed, last }]) } as unknown as Db;
  const subject = new Aggregation(db);
  const start = vi.spyOn(subject, 'start').mockReturnValue(subject.status());
  return { subject, start, db };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the daily sync', () => {
  it('runs at the first hourly check once the followed boards are a day old', async () => {
    vi.stubEnv('ENABLE_SYNC', 'true');
    const stale = aggregation(3, new Date(Date.now() - 25 * HOUR));
    await stale.subject.daily();
    expect(stale.start).toHaveBeenCalledOnce();
    const never = aggregation(1, null);
    await never.subject.daily();
    expect(never.start).toHaveBeenCalledOnce();
  });

  it('waits while the last sync is fresh, nothing is followed, or syncing is off', async () => {
    vi.stubEnv('ENABLE_SYNC', 'true');
    const fresh = aggregation(3, new Date(Date.now() - 2 * HOUR));
    await fresh.subject.daily();
    expect(fresh.start).not.toHaveBeenCalled();
    const none = aggregation(0, null);
    await none.subject.daily();
    expect(none.start).not.toHaveBeenCalled();

    vi.stubEnv('ENABLE_SYNC', 'false');
    const off = aggregation(3, null);
    await off.subject.daily();
    expect(off.start).not.toHaveBeenCalled();
    expect(off.db.$queryRaw).not.toHaveBeenCalled();
  });
});
