/*
  Warnings:

  - You are about to drop the column `commission_percent` on the `Service` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Service" DROP COLUMN "commission_percent",
ADD COLUMN     "commission" TEXT;
