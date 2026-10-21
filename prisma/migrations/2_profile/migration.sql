-- Part 3: the profile moves into tables (spec 3.1). The old LinkedIn rows
-- can fail checkDoc (no start date), so each one becomes a pending draft that
-- the user accepts in the Imports tab. Then the old tables are made again in
-- the new shape. The slug of a draft is "linkedin-" plus the last 8
-- characters of the old row ID, so it is unique for each user.

-- CreateTable
CREATE TABLE "ProfileDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "warningsApproved" BOOLEAN NOT NULL DEFAULT false,
    "matches" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProfileDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProfileDraft_userId_status_idx" ON "ProfileDraft"("userId", "status");

-- Data: one draft for each old row
INSERT INTO "ProfileDraft" ("id", "userId", "batchId", "source", "type", "data", "updatedAt")
SELECT lower(hex(randomblob(12))), "userId", 'migration', 'linkedin', 'position',
       json_object('id', 'linkedin-' || lower(substr("id", -8)), 'title', "title", 'company', "company", 'location', "location",
                   'start', CASE WHEN "startedAt" IS NULL THEN NULL ELSE strftime('%Y-%m', "startedAt" / 1000, 'unixepoch') END,
                   'end', CASE WHEN "endedAt" IS NULL THEN NULL ELSE strftime('%Y-%m', "endedAt" / 1000, 'unixepoch') END,
                   'summary', "summary", 'bullets', json_array()),
       CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "Position";

INSERT INTO "ProfileDraft" ("id", "userId", "batchId", "source", "type", "data", "updatedAt")
SELECT lower(hex(randomblob(12))), "userId", 'migration', 'linkedin', 'education',
       json_object('id', 'linkedin-' || lower(substr("id", -8)), 'school', "school", 'degree', "degree", 'field', "field", 'years', "years", 'aliases', json_array()),
       CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "Education";

INSERT INTO "ProfileDraft" ("id", "userId", "batchId", "source", "type", "data", "updatedAt")
SELECT lower(hex(randomblob(12))), "userId", 'migration', 'linkedin', 'project',
       json_object('id', 'linkedin-' || lower(substr("id", -8)), 'title', "title", 'org', "org", 'description', "description", 'url', "url", 'source', 'linkedin'),
       CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "ProjectItem";

INSERT INTO "ProfileDraft" ("id", "userId", "batchId", "source", "type", "data", "updatedAt")
SELECT lower(hex(randomblob(12))), "userId", 'migration', 'linkedin', 'claim',
       json_object('slug', 'skill-' || lower(substr("id", -8)), 'kind', 'skill', 'label', "name", 'aliases', json_array(), 'links', json_array(),
                   'evidence', json_array(), 'mentions', json_array(json_object('surface', 'linkedin-skills', 'listed', json('true')))),
       CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "Skill";

-- DropTable
DROP TABLE "Skill";
DROP TABLE "Position";
DROP TABLE "Education";
DROP TABLE "ProjectItem";

-- CreateTable
CREATE TABLE "ProfileMeta" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProfileMeta_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "start" TEXT NOT NULL,
    "end" TEXT,
    "summary" TEXT,
    "order" INTEGER NOT NULL,
    CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PositionBullet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "positionId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "match" TEXT NOT NULL,
    "text" TEXT,
    "order" INTEGER NOT NULL,
    CONSTRAINT "PositionBullet_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Education" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "school" TEXT NOT NULL,
    "degree" TEXT,
    "field" TEXT,
    "years" TEXT,
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "order" INTEGER NOT NULL,
    CONSTRAINT "Education_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "org" TEXT,
    "description" TEXT,
    "url" TEXT,
    "tex" TEXT,
    "bullets" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "repoUrl" TEXT,
    "order" INTEGER NOT NULL,
    CONSTRAINT "ProjectItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "value" REAL,
    "scaleMax" REAL,
    "higherIsBetter" BOOLEAN,
    "order" INTEGER NOT NULL,
    CONSTRAINT "Claim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaimLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "rel" TEXT NOT NULL,
    "w" REAL NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "ClaimLink_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClaimLink_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaimEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "depth" TEXT NOT NULL,
    "proof" TEXT,
    "since" TEXT,
    "order" INTEGER NOT NULL,
    CONSTRAINT "ClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaimMention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "url" TEXT,
    "listed" BOOLEAN NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "ClaimMention_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProfileRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfileRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GithubCache" (
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "etag" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "url"),
    CONSTRAINT "GithubCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Position_userId_slug_key" ON "Position"("userId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "PositionBullet_positionId_slug_key" ON "PositionBullet"("positionId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Education_userId_slug_key" ON "Education"("userId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectItem_userId_slug_key" ON "ProjectItem"("userId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_userId_slug_key" ON "Claim"("userId", "slug");

-- CreateIndex
CREATE INDEX "ClaimLink_fromId_idx" ON "ClaimLink"("fromId");

-- CreateIndex
CREATE INDEX "ClaimLink_toId_idx" ON "ClaimLink"("toId");

-- CreateIndex
CREATE INDEX "ClaimEvidence_claimId_idx" ON "ClaimEvidence"("claimId");

-- CreateIndex
CREATE INDEX "ClaimMention_claimId_idx" ON "ClaimMention"("claimId");

-- CreateIndex
CREATE INDEX "ProfileRevision_userId_createdAt_idx" ON "ProfileRevision"("userId", "createdAt");
