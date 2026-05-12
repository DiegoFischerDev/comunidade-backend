-- AlterTable
ALTER TABLE "redirect_click_events" ADD COLUMN "visitor_key" VARCHAR(128);

-- Um cookie `rd_vid` (visitante) só conta uma vez por link personalizado / por imóvel.
CREATE UNIQUE INDEX "redirect_click_events_share_visitor_uidx"
ON "redirect_click_events" ("partner_share_link_id", "visitor_key")
WHERE "partner_share_link_id" IS NOT NULL AND "visitor_key" IS NOT NULL;

CREATE UNIQUE INDEX "redirect_click_events_house_visitor_uidx"
ON "redirect_click_events" ("partner_house_id", "visitor_key")
WHERE "partner_house_id" IS NOT NULL AND "visitor_key" IS NOT NULL;
