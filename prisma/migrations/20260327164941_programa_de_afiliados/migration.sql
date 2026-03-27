/*
  Warnings:

  - You are about to drop the column `invoice_city` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `invoice_email` on the `Sale` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Sale" DROP COLUMN "invoice_city",
DROP COLUMN "invoice_email";
