/*
  Warnings:

  - You are about to drop the column `cashback_euro` on the `Service` table. All the data in the column will be lost.
  - You are about to drop the column `commission` on the `Service` table. All the data in the column will be lost.
  - You are about to drop the column `pending_approval` on the `Service` table. All the data in the column will be lost.
  - You are about to drop the `Sale` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_partner_id_fkey";

-- DropForeignKey
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_service_id_fkey";

-- DropForeignKey
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_user_id_fkey";

-- AlterTable
ALTER TABLE "Service" DROP COLUMN "cashback_euro",
DROP COLUMN "commission",
DROP COLUMN "pending_approval";

-- DropTable
DROP TABLE "Sale";

-- DropEnum
DROP TYPE "CommissionPaymentStatus";

-- DropEnum
DROP TYPE "SaleStatus";
