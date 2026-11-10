-- ONE-TIME upgrade for a Postgres database that was created with `prisma db push` (before versioned migrations, i.e. the
-- first Vercel deployment). A fresh database does NOT need this: `prisma migrate deploy` creates everything.
-- It brings the old schema to exactly the state of migration 20261110134554_init, keeping all data:
--   DateTime columns timestamp(3) → timestamptz(3) (Prisma stored UTC, so values are read AS UTC), User.name collation "C",
--   and the new indexes. Then mark the init migration as applied and deploy the rest (RLS lockdown):
--     npx prisma db execute --file prisma/upgrade-from-db-push.sql
--     npx prisma migrate resolve --applied 20261110134554_init
--     npx prisma migrate deploy && npm run db:check-rls
-- (DIRECT_URL must point at that database.) Take a backup first (Supabase → Database → Backups).
BEGIN;
ALTER TABLE "User"
  ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(3) USING "deletedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Membership"
  ALTER COLUMN "verifiedAt" TYPE TIMESTAMPTZ(3) USING "verifiedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "startsAt" TYPE TIMESTAMPTZ(3) USING "startsAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "renewsAt" TYPE TIMESTAMPTZ(3) USING "renewsAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Event"
  ALTER COLUMN "startsAt" TYPE TIMESTAMPTZ(3) USING "startsAt" AT TIME ZONE 'UTC';
ALTER TABLE "Registration"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "CpeEntry"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "AuditLog"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "LoginThrottle"
  ALTER COLUMN "lastFailAt" TYPE TIMESTAMPTZ(3) USING "lastFailAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "lockedUntil" TYPE TIMESTAMPTZ(3) USING "lockedUntil" AT TIME ZONE 'UTC';
ALTER TABLE "ContactMessage"
  ALTER COLUMN "handledAt" TYPE TIMESTAMPTZ(3) USING "handledAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "User" ALTER COLUMN "name" TYPE TEXT COLLATE "C";
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
CREATE INDEX IF NOT EXISTS "Membership_userId_status_idx" ON "Membership"("userId", "status");
CREATE INDEX IF NOT EXISTS "Membership_status_createdAt_idx" ON "Membership"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Event_published_startsAt_idx" ON "Event"("published", "startsAt");
CREATE INDEX IF NOT EXISTS "Registration_eventId_idx" ON "Registration"("eventId");
CREATE INDEX IF NOT EXISTS "CpeEntry_userId_idx" ON "CpeEntry"("userId");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_target_idx" ON "AuditLog"("target");
COMMIT;
