-- Destinos WhatsApp: de 1 por região → lista de grupos (todas as ofertas em todos)

CREATE TABLE "job_offer_whatsapp_destinations_new" (
  "id" TEXT NOT NULL,
  "dest_group_jid" TEXT NOT NULL,
  "dest_title" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "job_offer_whatsapp_destinations_new_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_offer_whatsapp_destinations_new_dest_group_jid_key"
  ON "job_offer_whatsapp_destinations_new"("dest_group_jid");

INSERT INTO "job_offer_whatsapp_destinations_new" (
  "id",
  "dest_group_jid",
  "dest_title",
  "active",
  "created_at",
  "updated_at"
)
SELECT DISTINCT ON (TRIM("dest_group_jid"))
  gen_random_uuid()::text,
  TRIM("dest_group_jid"),
  "dest_title",
  "active",
  CURRENT_TIMESTAMP,
  "updated_at"
FROM "job_offer_whatsapp_destinations"
WHERE "dest_group_jid" IS NOT NULL
  AND TRIM("dest_group_jid") <> ''
ORDER BY TRIM("dest_group_jid"), "updated_at" DESC;

DROP TABLE "job_offer_whatsapp_destinations";

ALTER TABLE "job_offer_whatsapp_destinations_new"
  RENAME TO "job_offer_whatsapp_destinations";

ALTER INDEX "job_offer_whatsapp_destinations_new_pkey"
  RENAME TO "job_offer_whatsapp_destinations_pkey";

ALTER INDEX "job_offer_whatsapp_destinations_new_dest_group_jid_key"
  RENAME TO "job_offer_whatsapp_destinations_dest_group_jid_key";
