-- AlterTable
ALTER TABLE "Job" ADD COLUMN "remote" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Job_remote_idx" ON "Job"("remote");

-- The stored jobs keep only the first part of their location, as "city". A city that says remote marks the job.
-- The next refresh of a board sets the flag from the full location.
UPDATE "Job" SET "remote" = true WHERE lower("city") LIKE '%remote%';
