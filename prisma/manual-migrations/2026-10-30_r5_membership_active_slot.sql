-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "activeSlot" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Membership_activeSlot_key" ON "Membership"("activeSlot");

