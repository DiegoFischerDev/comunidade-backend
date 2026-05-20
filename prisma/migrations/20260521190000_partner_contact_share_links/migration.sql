-- AlterTable
ALTER TABLE "partners" ADD COLUMN "hero_share_link_id" TEXT;

-- AlterTable
ALTER TABLE "services" ADD COLUMN "partner_share_link_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "partners_hero_share_link_id_key" ON "partners"("hero_share_link_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_partner_share_link_id_key" ON "services"("partner_share_link_id");

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_hero_share_link_id_fkey" FOREIGN KEY ("hero_share_link_id") REFERENCES "partner_share_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_partner_share_link_id_fkey" FOREIGN KEY ("partner_share_link_id") REFERENCES "partner_share_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
