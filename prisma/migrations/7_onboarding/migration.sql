-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN "onboardedAt" DATETIME;
ALTER TABLE "UserSettings" ADD COLUMN "wizardStep" TEXT;

-- Each user that exists now gets a settings row (the defaults of 4_settings), if the user has none yet.
-- The admin gets 'own-tex': a row with 'own-tex' and no own file keeps RESUME_TEX of .env (resumeConfig).
-- A 'template' row would move the live admin résumé to the built-in template at deploy.
INSERT INTO "UserSettings" ("userId", "fields", "visaStatus", "resumeMode", "templateId", "updatedAt")
SELECT "id", '[]', '', CASE WHEN "role" = 'admin' THEN 'own-tex' ELSE 'template' END, 'classic', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "User"
WHERE "id" NOT IN (SELECT "userId" FROM "UserSettings");

-- An existing user is set up already. Only users made after this migration see the onboarding wizard.
UPDATE "UserSettings" SET "onboardedAt" = CAST(strftime('%s', 'now') AS INTEGER) * 1000;
