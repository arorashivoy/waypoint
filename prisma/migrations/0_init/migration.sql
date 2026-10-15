-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "picture" TEXT,
    "linkedin" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CountryPref" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "cc" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "on" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "CountryPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProfileImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "counts" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfileImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "summary" TEXT,
    CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Education" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "school" TEXT NOT NULL,
    "degree" TEXT,
    "field" TEXT,
    "years" TEXT,
    CONSTRAINT "Education_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "org" TEXT,
    "description" TEXT,
    "url" TEXT,
    "tags" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ProjectItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Skill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "company" TEXT,
    "position" TEXT,
    "profileUrl" TEXT,
    "connectedAt" DATETIME,
    "degree" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Contact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "cc" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'On-site',
    "field" TEXT NOT NULL DEFAULT 'Backend',
    "level" TEXT NOT NULL DEFAULT 'Mid',
    "sponsor" BOOLEAN NOT NULL DEFAULT false,
    "visa" TEXT NOT NULL DEFAULT 'Sponsorship not stated',
    "description" TEXT NOT NULL DEFAULT '',
    "postedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analysis" TEXT,
    "analysedAt" DATETIME,
    "analysisTries" INTEGER NOT NULL DEFAULT 0,
    "priority" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "note" TEXT NOT NULL DEFAULT '',
    "match" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "cvUrl" TEXT,
    "cvPath" TEXT,
    "cvLead" TEXT,
    "cvSentAt" DATETIME,
    "cvDriveId" TEXT,
    "cvSteer" TEXT,
    "cvChat" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutreachEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contactName" TEXT,
    "contactInit" TEXT,
    "contactUrl" TEXT,
    "org" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "incoming" TEXT,
    "reason" TEXT,
    "certain" BOOLEAN NOT NULL DEFAULT false,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutreachEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LlmCache" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CountryPref_userId_cc_key" ON "CountryPref"("userId", "cc");

-- CreateIndex
CREATE INDEX "Contact_userId_company_idx" ON "Contact"("userId", "company");

-- CreateIndex
CREATE UNIQUE INDEX "Job_externalId_key" ON "Job"("externalId");

-- CreateIndex
CREATE INDEX "Job_cc_postedAt_idx" ON "Job"("cc", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Application_userId_jobId_key" ON "Application"("userId", "jobId");

-- CreateIndex
CREATE INDEX "LlmCache_kind_usedAt_idx" ON "LlmCache"("kind", "usedAt");

