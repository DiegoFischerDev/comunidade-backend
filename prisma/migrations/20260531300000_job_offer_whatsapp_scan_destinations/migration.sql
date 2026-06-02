-- Enum: destino regional não configurado
ALTER TYPE "JobOfferWhatsappMessageStatus" ADD VALUE IF NOT EXISTS 'skipped_no_destination';

-- Grupos de scan (origem)
CREATE TABLE "job_offer_whatsapp_scans" (
  "id" TEXT NOT NULL,
  "source_group_jid" TEXT NOT NULL,
  "source_title" TEXT,
  "monitored_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "monitor_all_members" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "job_offer_whatsapp_scans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_offer_whatsapp_scans_source_group_jid_key"
  ON "job_offer_whatsapp_scans"("source_group_jid");

CREATE INDEX "job_offer_whatsapp_scans_source_group_jid_active_idx"
  ON "job_offer_whatsapp_scans"("source_group_jid", "active");

-- Destinos fixos por região
CREATE TABLE "job_offer_whatsapp_destinations" (
  "region" "JobOfferRegion" NOT NULL,
  "dest_group_jid" TEXT,
  "dest_title" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "job_offer_whatsapp_destinations_pkey" PRIMARY KEY ("region")
);

INSERT INTO "job_offer_whatsapp_destinations" ("region", "dest_group_jid", "dest_title", "active", "updated_at")
VALUES
  ('NORTE', NULL, NULL, false, CURRENT_TIMESTAMP),
  ('CENTRO', NULL, NULL, false, CURRENT_TIMESTAMP),
  ('SUL', NULL, NULL, false, CURRENT_TIMESTAMP);

-- Migrar scans a partir das rotas (um scan por grupo de origem)
INSERT INTO "job_offer_whatsapp_scans" (
  "id",
  "source_group_jid",
  "source_title",
  "monitored_numbers",
  "monitor_all_members",
  "active",
  "created_at",
  "updated_at"
)
SELECT DISTINCT ON ("source_group_jid")
  "id",
  "source_group_jid",
  "source_title",
  "monitored_numbers",
  "monitor_all_members",
  "active",
  "created_at",
  "updated_at"
FROM "job_offer_whatsapp_routes"
ORDER BY "source_group_jid", "created_at" ASC;

-- Migrar destinos a partir das rotas com publish_region
UPDATE "job_offer_whatsapp_destinations" d
SET
  "dest_group_jid" = r."dest_group_jid",
  "dest_title" = r."dest_title",
  "active" = r."active",
  "updated_at" = r."updated_at"
FROM (
  SELECT DISTINCT ON ("publish_region")
    "publish_region",
    "dest_group_jid",
    "dest_title",
    "active",
    "updated_at"
  FROM "job_offer_whatsapp_routes"
  WHERE "publish_region" IS NOT NULL
    AND TRIM("dest_group_jid") <> ''
  ORDER BY "publish_region", "created_at" ASC
) r
WHERE d."region" = r."publish_region";

-- Rotas sem região: preencher destinos ainda vazios com o primeiro destino legado
UPDATE "job_offer_whatsapp_destinations" d
SET
  "dest_group_jid" = r."dest_group_jid",
  "dest_title" = r."dest_title",
  "active" = r."active",
  "updated_at" = r."updated_at"
FROM (
  SELECT
    "dest_group_jid",
    "dest_title",
    "active",
    "updated_at"
  FROM "job_offer_whatsapp_routes"
  WHERE "publish_region" IS NULL
    AND TRIM("dest_group_jid") <> ''
  ORDER BY "created_at" ASC
  LIMIT 1
) r
WHERE d."dest_group_jid" IS NULL;

-- Mensagens: route_id → scan_id (mesmo id da rota migrada como scan)
ALTER TABLE "job_offer_whatsapp_messages" ADD COLUMN "scan_id" TEXT;

UPDATE "job_offer_whatsapp_messages" m
SET "scan_id" = s."id"
FROM "job_offer_whatsapp_scans" s
JOIN "job_offer_whatsapp_routes" r ON r."id" = s."id"
WHERE m."route_id" = r."id";

ALTER TABLE "job_offer_whatsapp_messages" DROP CONSTRAINT IF EXISTS "job_offer_whatsapp_messages_route_id_fkey";
DROP INDEX IF EXISTS "job_offer_whatsapp_messages_route_id_external_message_id_key";
DROP INDEX IF EXISTS "job_offer_whatsapp_messages_route_id_idx";

ALTER TABLE "job_offer_whatsapp_messages" DROP COLUMN "route_id";

ALTER TABLE "job_offer_whatsapp_messages"
  ADD CONSTRAINT "job_offer_whatsapp_messages_scan_id_fkey"
  FOREIGN KEY ("scan_id") REFERENCES "job_offer_whatsapp_scans"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "job_offer_whatsapp_messages_scan_id_external_message_id_key"
  ON "job_offer_whatsapp_messages"("scan_id", "external_message_id");

CREATE INDEX "job_offer_whatsapp_messages_scan_id_idx"
  ON "job_offer_whatsapp_messages"("scan_id");

DROP TABLE "job_offer_whatsapp_routes";
