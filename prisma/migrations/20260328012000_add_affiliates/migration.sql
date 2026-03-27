-- CreateEnum
CREATE TYPE "AffiliateCommissionStatus" AS ENUM ('PENDING', 'PAID');

-- CreateEnum
CREATE TYPE "AffiliateCommissionCurrency" AS ENUM ('EUR', 'BRL');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "referred_by_affiliate_id" TEXT,
ADD COLUMN "referred_at" TIMESTAMP(3),
ADD COLUMN "referred_by_code_snapshot" TEXT;

-- CreateTable
CREATE TABLE "AffiliateProfile" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "instagram_handle" TEXT NOT NULL,
    "affiliate_code" TEXT NOT NULL,
    "payout_method" "CashbackPayoutMethod" NOT NULL DEFAULT 'MBWAY',
    "mbway_number" TEXT,
    "mbway_name" TEXT,
    "pix_key" TEXT,
    "pix_name" TEXT,
    "terms_accepted_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateCommission" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "referred_user_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" "AffiliateCommissionCurrency" NOT NULL,
    "status" "AffiliateCommissionStatus" NOT NULL DEFAULT 'PENDING',
    "payment_proof_url" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateProfile_user_id_key" ON "AffiliateProfile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateProfile_affiliate_code_key" ON "AffiliateProfile"("affiliate_code");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCommission_referred_user_id_key" ON "AffiliateCommission"("referred_user_id");

-- CreateIndex
CREATE INDEX "AffiliateCommission_affiliate_id_status_idx" ON "AffiliateCommission"("affiliate_id", "status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referred_by_affiliate_id_fkey" FOREIGN KEY ("referred_by_affiliate_id") REFERENCES "AffiliateProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateProfile" ADD CONSTRAINT "AffiliateProfile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "AffiliateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

