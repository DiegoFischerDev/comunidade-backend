-- AlterTable
ALTER TABLE "Partner" ADD COLUMN "hero_share_link_id" TEXT;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN "partner_share_link_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Partner_hero_share_link_id_key" ON "Partner"("hero_share_link_id");

-- CreateIndex
CREATE UNIQUE INDEX "Service_partner_share_link_id_key" ON "Service"("partner_share_link_id");

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_hero_share_link_id_fkey" FOREIGN KEY ("hero_share_link_id") REFERENCES "partner_share_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_partner_share_link_id_fkey" FOREIGN KEY ("partner_share_link_id") REFERENCES "partner_share_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
