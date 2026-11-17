-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "total" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "dismissedAt" DATETIME
);

-- CreateTable
CREATE TABLE "JobItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "resourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "resultId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockedAt" DATETIME,
    CONSTRAINT "JobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduledTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "shop" TEXT,
    "nextRunAt" DATETIME NOT NULL,
    "intervalMinutes" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "Job_shop_status_idx" ON "Job"("shop", "status");

-- CreateIndex
CREATE INDEX "Job_shop_createdAt_idx" ON "Job"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "JobItem_jobId_position_idx" ON "JobItem"("jobId", "position");

-- CreateIndex
CREATE INDEX "JobItem_status_runAfter_idx" ON "JobItem"("status", "runAfter");

-- CreateIndex
CREATE INDEX "JobItem_lockedBy_idx" ON "JobItem"("lockedBy");

-- CreateIndex
CREATE INDEX "ScheduledTask_nextRunAt_idx" ON "ScheduledTask"("nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduledTask_name_shop_idx" ON "ScheduledTask"("name", "shop");

