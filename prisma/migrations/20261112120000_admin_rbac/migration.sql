-- Admin Portal users & roles (RBAC, round 7). Additive only: new table "AdminRole", new columns User.active and User.adminRoleId.
-- Existing admins get the "Super Admin" system role so they keep full access after deploy. Safe to re-run (IF NOT EXISTS,
-- ON CONFLICT, guarded constraint); the resulting schema is exactly what schema.prisma describes (no migrate drift).

-- CreateTable
CREATE TABLE IF NOT EXISTS "AdminRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AdminRole_name_key" ON "AdminRole"("name");

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "adminRoleId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_adminRoleId_idx" ON "User"("adminRoleId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_adminRoleId_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_adminRoleId_fkey" FOREIGN KEY ("adminRoleId") REFERENCES "AdminRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Supabase lockdown for the new table (see 20261110134600_supabase_rls_lockdown): RLS on with no policies, and no Data API grants.
ALTER TABLE "AdminRole" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'AdminRole', r);
    END IF;
  END LOOP;
END $$;

-- Data: the Super Admin system role (deterministic id, every permission) ...
INSERT INTO "AdminRole" ("id", "name", "description", "permissions", "isSystem", "createdAt", "updatedAt")
VALUES (
  'sys_super_admin',
  'Super Admin',
  'Full access to every Admin Portal module. System role: it cannot be renamed, changed or deleted.',
  '{"members":["view","create","edit","delete"],"events":["view","create","edit","delete"],"messages":["view","edit"],"users":["view","create","edit"],"roles":["view","create","edit","delete"],"system":["view","edit"]}'::jsonb,
  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT DO NOTHING;

-- ... assigned to every existing admin account (production has admins: they must keep full access).
UPDATE "User" SET "adminRoleId" = 'sys_super_admin' WHERE "role" = 'admin' AND "adminRoleId" IS NULL;
