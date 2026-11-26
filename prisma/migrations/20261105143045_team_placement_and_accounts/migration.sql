-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN     "pageId" UUID;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastLoginAt" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "StaffMember_pageId_idx" ON "StaffMember"("pageId");

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
