-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMPTZ,
    "lastError" TEXT,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "boardId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMPTZ,
    "seenAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'saved',
    "rejected" BOOLEAN NOT NULL DEFAULT false,
    "resumeVersion" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "rejected" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Board_provider_slug_key" ON "Board"("provider", "slug");

-- CreateIndex
CREATE INDEX "Job_active_publishedAt_id_idx" ON "Job"("active", "publishedAt" DESC, "id");

-- CreateIndex
CREATE INDEX "Job_company_active_idx" ON "Job"("company", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Job_boardId_externalId_key" ON "Job"("boardId", "externalId");

-- CreateIndex
CREATE INDEX "Application_userId_stage_createdAt_idx" ON "Application"("userId", "stage", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Application_jobId_idx" ON "Application"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_userId_jobId_email_key" ON "Application"("userId", "jobId", "email");

-- CreateIndex
CREATE INDEX "ApplicationEvent_applicationId_createdAt_idx" ON "ApplicationEvent"("applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Search and pagination indexes are tied to the actual list query.
CREATE INDEX job_search_idx ON "Job" USING GIN
  (to_tsvector('english', title || ' ' || company || ' ' || location || ' ' || description));
CREATE INDEX job_active_order_idx ON "Job" ("publishedAt" DESC NULLS LAST, id DESC) WHERE active;

-- Time-series observations grow with every sync. Stable jobs/applications are not time-partitioned.
CREATE TABLE job_observations (
  job_id uuid NOT NULL REFERENCES "Job"(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  board_id uuid NOT NULL REFERENCES "Board"(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, observed_at)
) PARTITION BY RANGE (observed_at);
DO $$
DECLARE start_month date;
BEGIN
  FOR start_month IN SELECT generate_series('2026-01-01'::date, '2027-12-01'::date, '1 month')::date LOOP
    EXECUTE format('CREATE TABLE job_observations_%s PARTITION OF job_observations FOR VALUES FROM (%L) TO (%L)',
      to_char(start_month, 'YYYY_MM'), start_month::timestamptz, (start_month + interval '1 month')::timestamptz);
  END LOOP;
END $$;
CREATE TABLE job_observations_default PARTITION OF job_observations DEFAULT;
CREATE INDEX job_observations_board_time_idx ON job_observations (board_id, observed_at DESC);

CREATE MATERIALIZED VIEW job_board_stats AS
  SELECT b.id AS board_id, b.company, b.provider,
    count(j.id)::int AS total_jobs,
    count(j.id) FILTER (WHERE j.active)::int AS active_jobs,
    count(j.id) FILTER (WHERE j.active AND j.remote)::int AS remote_jobs,
    max(j."seenAt") AS observed_at
  FROM "Board" b LEFT JOIN "Job" j ON j."boardId" = b.id
  GROUP BY b.id, b.company, b.provider;
CREATE UNIQUE INDEX job_board_stats_id_idx ON job_board_stats (board_id);
