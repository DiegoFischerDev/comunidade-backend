-- CreateEnum
CREATE TYPE "RedirectClickKind" AS ENUM ('CUSTOM_LINK', 'HOUSE');

-- CreateTable
CREATE TABLE "partner_share_links" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "whatsapp_digits" TEXT NOT NULL,
    "whatsapp_phrase" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redirect_click_events" (
    "id" TEXT NOT NULL,
    "kind" "RedirectClickKind" NOT NULL,
    "clicked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partner_share_link_id" TEXT,
    "partner_house_id" TEXT,

    CONSTRAINT "redirect_click_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_share_links_slug_key" ON "partner_share_links"("slug");

-- CreateIndex
CREATE INDEX "redirect_click_events_kind_clicked_at_idx" ON "redirect_click_events"("kind", "clicked_at");

-- CreateIndex
CREATE INDEX "redirect_click_events_partner_share_link_id_clicked_at_idx" ON "redirect_click_events"("partner_share_link_id", "clicked_at");

-- CreateIndex
CREATE INDEX "redirect_click_events_partner_house_id_clicked_at_idx" ON "redirect_click_events"("partner_house_id", "clicked_at");

-- AddForeignKey
ALTER TABLE "redirect_click_events" ADD CONSTRAINT "redirect_click_events_partner_share_link_id_fkey" FOREIGN KEY ("partner_share_link_id") REFERENCES "partner_share_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redirect_click_events" ADD CONSTRAINT "redirect_click_events_partner_house_id_fkey" FOREIGN KEY ("partner_house_id") REFERENCES "partner_houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
