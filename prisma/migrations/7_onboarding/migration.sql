-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN "onboardedAt" DATETIME;
ALTER TABLE "UserSettings" ADD COLUMN "wizardStep" TEXT;

-- Each user that exists now gets a settings row (the defaults of 4_settings), if the user has none yet.
INSERT INTO "UserSettings" ("userId", "fields", "visaStatus", "resumeMode", "templateId", "updatedAt")
SELECT "id", '[]', '', 'template', 'classic', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "User"
WHERE "id" NOT IN (SELECT "userId" FROM "UserSettings");

-- An existing user is set up already. Only users made after this migration see the onboarding wizard.
UPDATE "UserSettings" SET "onboardedAt" = CAST(strftime('%s', 'now') AS INTEGER) * 1000;
