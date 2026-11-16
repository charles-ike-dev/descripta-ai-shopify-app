-- AlterTable
ALTER TABLE "Generation" ADD COLUMN "appliedHtml" TEXT;
ALTER TABLE "Generation" ADD COLUMN "batchId" TEXT;

-- CreateIndex
CREATE INDEX "Generation_shop_batchId_idx" ON "Generation"("shop", "batchId");
