-- Rotas múltiplas origem → destino (substitui config singleton).

CREATE TABLE "job_offer_whatsapp_routes" (
  "id" TEXT NOT NULL,
  "source_group_jid" TEXT NOT NULL,
  "source_title" TEXT,
  "dest_group_jid" TEXT NOT NULL,
  "dest_title" TEXT,
  "monitored_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "monitor_all_members" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "job_offer_whatsapp_routes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_offer_whatsapp_routes_source_group_jid_dest_group_jid_key"
  ON "job_offer_whatsapp_routes"("source_group_jid", "dest_group_jid");

CREATE INDEX "job_offer_whatsapp_routes_source_group_jid_active_idx"
  ON "job_offer_whatsapp_routes"("source_group_jid", "active");

-- Migrar configuração singleton (se existir)
INSERT INTO "job_offer_whatsapp_routes" (
  "id",
  "source_group_jid",
  "source_title",
  "dest_group_jid",
  "dest_title",
  "monitored_numbers",
  "monitor_all_members",
  "active",
  "updated_at"
)
SELECT
  'migrated_default',
  "source_group_jid",
  "source_title",
  "dest_group_jid",
  "dest_title",
  "monitored_numbers",
  "monitor_all_members",
  "active",
  "updated_at"
FROM "job_offer_whatsapp_config"
WHERE "id" = 'default'
  AND "source_group_jid" IS NOT NULL
  AND TRIM("source_group_jid") <> ''
  AND "dest_group_jid" IS NOT NULL
  AND TRIM("dest_group_jid") <> ''
ON CONFLICT ("source_group_jid", "dest_group_jid") DO NOTHING;

ALTER TABLE "job_offer_whatsapp_messages" ADD COLUMN "route_id" TEXT;

UPDATE "job_offer_whatsapp_messages"
SET "route_id" = 'migrated_default'
WHERE "route_id" IS NULL
  AND EXISTS (SELECT 1 FROM "job_offer_whatsapp_routes" WHERE "id" = 'migrated_default');

ALTER TABLE "job_offer_whatsapp_messages"
  ADD CONSTRAINT "job_offer_whatsapp_messages_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "job_offer_whatsapp_routes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "job_offer_whatsapp_messages_external_message_id_key";

CREATE UNIQUE INDEX "job_offer_whatsapp_messages_route_id_external_message_id_key"
  ON "job_offer_whatsapp_messages"("route_id", "external_message_id");

CREATE INDEX "job_offer_whatsapp_messages_route_id_idx"
  ON "job_offer_whatsapp_messages"("route_id");

DROP TABLE "job_offer_whatsapp_config";
