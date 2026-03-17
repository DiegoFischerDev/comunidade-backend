-- DropForeignKey
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_service_id_fkey";

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "service_title" TEXT,
ALTER COLUMN "service_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
