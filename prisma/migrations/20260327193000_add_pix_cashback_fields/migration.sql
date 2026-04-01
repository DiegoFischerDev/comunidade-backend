-- CreateEnum
CREATE TYPE "CashbackPayoutMethod" AS ENUM ('MBWAY', 'PIX');

-- AlterTable
ALTER TABLE "Sale"
ADD COLUMN "cashback_payout_method" "CashbackPayoutMethod",
ADD COLUMN "cashback_pix_key" TEXT,
ADD COLUMN "cashback_pix_name" TEXT;

