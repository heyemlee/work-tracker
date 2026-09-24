import { STAGES, type Application, type JobStatus, type Stage } from './types';

export function stageRank(stage: Stage): number {
  return STAGES.indexOf(stage);
}

export interface Rollup {
  status: JobStatus;
  /** True when the job has applications and every one of them was rejected. */
  rejected: boolean;
}

/**
 * A job shows the furthest stage among its live applications. When every application was rejected it shows
 * the furthest rejected one, so the list still says how far it got.
 */
export function rollup(applications: readonly Application[]): Rollup {
  const live = applications.filter((a) => !a.rejected);
  const pool = live.length > 0 ? live : applications;
  let best: Application | undefined;
  for (const app of pool) {
    if (!best || stageRank(app.stage) > stageRank(best.stage)) best = app;
  }
  if (!best) return { status: 'saved', rejected: false };
  return { status: best.stage, rejected: live.length === 0 };
}
