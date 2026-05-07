-- AlterTable
ALTER TABLE "house_relocation_whatsapp_groups" ADD COLUMN "business_type" TEXT NOT NULL DEFAULT 'RENT';

-- DropIndex (replaced by composite index including business_type)
DROP INDEX IF EXISTS "house_relocation_whatsapp_groups_active_sort_order_idx";

-- CreateIndex
CREATE INDEX "house_relocation_whatsapp_groups_active_business_type_sort_order_idx" ON "house_relocation_whatsapp_groups"("active", "business_type", "sort_order");
