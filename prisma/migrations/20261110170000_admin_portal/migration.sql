-- Admin portal: editable content (+ revisions), settings, event cancellation, CPE credits linked to events.

-- AlterTable
ALTER TABLE "CpeEntry" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "eventId" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "cancelledAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "ContentPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRevision" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentPage_slug_locale_key" ON "ContentPage"("slug", "locale");

-- CreateIndex
CREATE INDEX "ContentRevision_pageId_createdAt_idx" ON "ContentRevision"("pageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CpeEntry_userId_eventId_key" ON "CpeEntry"("userId", "eventId");

-- AddForeignKey
ALTER TABLE "CpeEntry" ADD CONSTRAINT "CpeEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRevision" ADD CONSTRAINT "ContentRevision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "ContentPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Supabase lockdown for the new tables (see 20261110134600_supabase_rls_lockdown).
ALTER TABLE "ContentPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContentRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Setting" ENABLE ROW LEVEL SECURITY;
