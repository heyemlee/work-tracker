export type LabQuery = { name: string; text: string; values: (string | number | boolean)[] };
const selectJobs = `SELECT j.id, j.title, j.company, j.location, j.department, j.url, j.remote,
  j."publishedAt", j."seenAt", j.active, b.provider
  FROM "Job" j JOIN "Board" b ON b.id = j."boardId" WHERE b.enabled = true AND j.active = true`;
const orderJobs = `ORDER BY j."publishedAt" DESC NULLS LAST, j.id DESC LIMIT 51 OFFSET 0`;
export const listQueries: LabQuery[] = [
  { name: 'recent-jobs', text: `${selectJobs} ${orderJobs}`, values: [] },
  {
    name: 'keyword-search',
    text: `${selectJobs} AND to_tsvector('english', j.title || ' ' || j.company || ' ' || j.location || ' ' || j.description) @@ websearch_to_tsquery('english', $1) ${orderJobs}`,
    values: ['kubernetes'],
  },
  {
    name: 'company-remote',
    text: `${selectJobs} AND j."boardId" = md5('board-10')::uuid AND j.remote = $1 ${orderJobs}`,
    values: [true],
  },
];
export const liveStats: LabQuery = {
  name: 'live-company-counts',
  text: `SELECT b.id AS board_id,
  count(j.id)::int AS total_jobs, count(j.id) FILTER (WHERE j.active)::int AS active_jobs,
  count(j.id) FILTER (WHERE j.active AND j.remote)::int AS remote_jobs
  FROM "Board" b LEFT JOIN "Job" j ON j."boardId" = b.id WHERE b.enabled = true
  GROUP BY b.id ORDER BY b.id`,
  values: [],
};
export const viewStats: LabQuery = {
  name: 'materialized-company-counts',
  text: `SELECT s.board_id, s.total_jobs, s.active_jobs, s.remote_jobs
  FROM board_stats s JOIN "Board" b ON s.board_id = b.id WHERE b.enabled = true ORDER BY s.board_id`,
  values: [],
};
export function observationQuery(partitioned: boolean, bounded: boolean): LabQuery {
  return {
    name: `${partitioned ? 'partitioned' : 'flat'}-${bounded ? 'one-month' : 'all-history'}`,
    text: `SELECT board_id, count(*)::int AS observations
    FROM ${partitioned ? 'observations_partitioned' : 'observations_flat'}
    ${bounded ? `WHERE observed_at >= $1::timestamptz AND observed_at < $2::timestamptz` : ''}
    GROUP BY board_id ORDER BY board_id`,
    values: bounded ? ['2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z'] : [],
  };
}
