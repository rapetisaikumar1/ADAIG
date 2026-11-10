-- Sign-in sessions are invalidated when staff reset a password (User.sessionVersion is compared with the JWT on every request).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

