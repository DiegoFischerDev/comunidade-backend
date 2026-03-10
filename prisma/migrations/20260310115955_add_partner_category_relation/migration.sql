-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "category_id" TEXT;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
