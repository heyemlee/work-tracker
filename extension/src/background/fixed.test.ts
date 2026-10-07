import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { snapshotsItem, type FormSnapshot } from '../storage';
import { dropFixedSnapshots, FIXED_SNAPSHOTS } from './fixed';

const shot = (id: string): FormSnapshot => ({
  id,
  at: '2026-10-06T12:00:00.000Z',
  ats: 'greenhouse',
  url: 'https://job-boards.greenhouse.io/arcadia/jobs/42',
  step: null,
  fields: [],
  html: '<form></form>',
});
const ids = async () => (await snapshotsItem.getValue()).map((item) => item.id);

describe('reports a build fixes', () => {
  beforeEach(() => fakeBrowser.reset());

  it('leave the list, and the open ones stay in their order', async () => {
    await snapshotsItem.setValue([shot('open-2'), shot('fixed-1'), shot('open-1'), shot('fixed-0')]);
    await dropFixedSnapshots(new Set(['fixed-0', 'fixed-1']));
    expect(await ids()).toEqual(['open-2', 'open-1']);
  });

  it('are the ones listed with this build, unless told otherwise', async () => {
    await snapshotsItem.setValue([...[...FIXED_SNAPSHOTS].map(shot), shot('open-1')]);
    await dropFixedSnapshots();
    expect(await ids()).toEqual(['open-1']);
  });

  it('leave a list with none of them alone', async () => {
    await snapshotsItem.setValue([shot('open-1')]);
    await dropFixedSnapshots(new Set(['fixed-0']));
    expect(await ids()).toEqual(['open-1']);
  });
});
