import { describe, expect, it } from 'vitest';
import { rollup } from './stages';
import { application } from './testing';

describe('rollup', () => {
  it('is saved when there are no applications', () => {
    expect(rollup([])).toEqual({ status: 'saved', rejected: false });
  });

  it('shows the furthest live stage', () => {
    const apps = [application('1', 'j', 'a'), application('2', 'j', 'b', { stage: 'oa' })];
    expect(rollup(apps)).toEqual({ status: 'oa', rejected: false });
  });

  it('prefers a live application over a rejected one that got further', () => {
    const apps = [
      application('1', 'j', 'a', { stage: 'oa', rejected: true }),
      application('2', 'j', 'b', { stage: 'applied' }),
    ];
    expect(rollup(apps)).toEqual({ status: 'applied', rejected: false });
  });

  it('keeps the furthest stage when everything was rejected', () => {
    const apps = [
      application('1', 'j', 'a', { rejected: true }),
      application('2', 'j', 'b', { stage: 'oa', rejected: true }),
    ];
    expect(rollup(apps)).toEqual({ status: 'oa', rejected: true });
  });
});
