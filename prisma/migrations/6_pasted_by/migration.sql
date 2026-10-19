-- AlterTable
ALTER TABLE "Job" ADD COLUMN "pastedBy" TEXT;

-- CreateIndex
CREATE INDEX "Job_pastedBy_idx" ON "Job"("pastedBy");
