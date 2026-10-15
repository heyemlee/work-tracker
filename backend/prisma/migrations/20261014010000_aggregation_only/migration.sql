-- Remove the previous local experiment's unused tracking and benchmarking structures.
-- "Board" and "Job" retain their imported job data; the online Outbox database is unrelated.
DROP TABLE "ApplicationEvent";
DROP TABLE "Application";
DROP TABLE "Session";
DROP TABLE "User";
DROP MATERIALIZED VIEW job_board_stats;
DROP TABLE job_observations;
ALTER TABLE "Board" ALTER COLUMN enabled SET DEFAULT false;
-- Previously all catalog entries were enabled automatically. Let the owner choose instead.
UPDATE "Board" SET enabled = false;
