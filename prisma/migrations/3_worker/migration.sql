-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "payload" TEXT NOT NULL,
    "result" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "startedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pid" INTEGER NOT NULL,
    "beatAt" DATETIME NOT NULL,
    "startedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FeedFetch" (
    "board" TEXT NOT NULL PRIMARY KEY,
    "etag" TEXT,
    "lastModified" TEXT,
    "fetchedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT
);

-- CreateIndex
CREATE INDEX "Task_status_runAt_idx" ON "Task"("status", "runAt");

-- CreateIndex
CREATE INDEX "Task_userId_kind_status_idx" ON "Task"("userId", "kind", "status");

-- CreateIndex
CREATE INDEX "Task_dedupeKey_status_idx" ON "Task"("dedupeKey", "status");

