-- Event joining instructions (shown only to confirmed registrants) and an index for audit-log actor filters.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "accessInfo" TEXT,
ADD COLUMN     "accessInfoFr" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_actor_idx" ON "AuditLog"("actor");

