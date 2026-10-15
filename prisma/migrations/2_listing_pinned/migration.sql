-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "pinnedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Listing_status_pinnedUntil_idx" ON "Listing"("status", "pinnedUntil");
