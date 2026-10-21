-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "fields" TEXT NOT NULL DEFAULT '[]',
    "visaStatus" TEXT NOT NULL DEFAULT '',
    "resumeMode" TEXT NOT NULL DEFAULT 'template',
    "ownTex" TEXT,
    "templateId" TEXT NOT NULL DEFAULT 'classic',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppState" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

