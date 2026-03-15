-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "cashback_mbway_name" TEXT,
ADD COLUMN     "cashback_mbway_number" TEXT,
ADD COLUMN     "cashback_requested_at" TIMESTAMP(3);
