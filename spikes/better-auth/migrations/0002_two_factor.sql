ALTER TABLE "user" ADD COLUMN "twoFactorEnabled" INTEGER DEFAULT 0;
CREATE TABLE "twoFactor" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "secret" TEXT NOT NULL,
  "backupCodes" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id"),
  "verified" INTEGER DEFAULT 1,
  "failedVerificationCount" INTEGER DEFAULT 0,
  "lockedUntil" INTEGER
);
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor" ("userId");
