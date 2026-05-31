-- CreateEnum
CREATE TYPE "JobOfferWhatsappMessageStatus" AS ENUM (
  'received',
  'ignored_sender',
  'ignored_not_offer',
  'created',
  'error'
);

-- CreateTable
CREATE TABLE "job_offer_whatsapp_config" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "source_group_jid" TEXT,
  "source_title" TEXT,
  "dest_group_jid" TEXT,
  "dest_title" TEXT,
  "monitored_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "monitor_all_members" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "job_offer_whatsapp_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_offer_whatsapp_messages" (
  "id" TEXT NOT NULL,
  "sender_number" TEXT NOT NULL,
  "external_message_id" TEXT,
  "raw_text" TEXT NOT NULL,
  "status" "JobOfferWhatsappMessageStatus" NOT NULL DEFAULT 'received',
  "parsed_json" JSONB,
  "created_job_offer_id" TEXT,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "job_offer_whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_offer_whatsapp_messages_external_message_id_key" ON "job_offer_whatsapp_messages"("external_message_id");

-- CreateIndex
CREATE INDEX "job_offer_whatsapp_messages_created_at_idx" ON "job_offer_whatsapp_messages"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "job_offer_whatsapp_messages" ADD CONSTRAINT "job_offer_whatsapp_messages_created_job_offer_id_fkey" FOREIGN KEY ("created_job_offer_id") REFERENCES "job_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default config row
INSERT INTO "job_offer_whatsapp_config" ("id", "updated_at")
VALUES ('default', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
