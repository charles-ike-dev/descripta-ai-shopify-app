-- CreateTable
CREATE TABLE "BrandVoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "brandName" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "audience" TEXT NOT NULL DEFAULT '',
    "length" TEXT NOT NULL DEFAULT 'medium',
    "language" TEXT NOT NULL DEFAULT 'English',
    "keywords" TEXT NOT NULL DEFAULT '',
    "avoidWords" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "previousHtml" TEXT NOT NULL,
    "previousSeoTitle" TEXT,
    "previousSeoDesc" TEXT,
    "descriptionHtml" TEXT NOT NULL,
    "seoTitle" TEXT NOT NULL,
    "seoDescription" TEXT NOT NULL,
    "highlights" TEXT NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandVoice_shop_key" ON "BrandVoice"("shop");

-- CreateIndex
CREATE INDEX "Generation_shop_productId_idx" ON "Generation"("shop", "productId");

-- CreateIndex
CREATE INDEX "Generation_shop_createdAt_idx" ON "Generation"("shop", "createdAt");
