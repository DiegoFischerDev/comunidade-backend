/*
  Warnings:

  - You are about to drop the column `invoice_city` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `invoice_email` on the `Sale` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Sale"
DROP COLUMN IF EXISTS "invoice_city",
DROP COLUMN IF EXISTS "invoice_email";
