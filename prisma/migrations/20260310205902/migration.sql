/*
  Warnings:

  - You are about to drop the column `source` on the `Lead` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[partner_id,user_id]` on the table `Lead` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Lead" DROP COLUMN "source";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "name" TEXT,
ADD COLUMN     "whatsapp" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_partner_id_user_id_key" ON "Lead"("partner_id", "user_id");
