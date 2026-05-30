-- Whatsapp scan: monitorização de grupos + log de mensagens processadas

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WhatsappScanMessageStatus') THEN
    CREATE TYPE "WhatsappScanMessageStatus" AS ENUM (
      'received',
      'ignored_sender',
      'ignored_not_listing',
      'created',
      'error'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "whatsapp_scan_groups" (
  "id" TEXT NOT NULL,
  "partner_id" TEXT NOT NULL,
  "group_jid" TEXT NOT NULL,
  "monitored_numbers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_scan_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_scan_groups_group_jid_key"
  ON "whatsapp_scan_groups"("group_jid");

CREATE INDEX IF NOT EXISTS "whatsapp_scan_groups_partner_id_idx"
  ON "whatsapp_scan_groups"("partner_id");

CREATE TABLE IF NOT EXISTS "whatsapp_scan_messages" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "sender_number" TEXT NOT NULL,
  "external_message_id" TEXT,
  "raw_text" TEXT NOT NULL,
  "status" "WhatsappScanMessageStatus" NOT NULL DEFAULT 'received',
  "parsed_json" JSONB,
  "created_house_id" TEXT,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_scan_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_scan_messages_external_message_id_key"
  ON "whatsapp_scan_messages"("external_message_id");

CREATE INDEX IF NOT EXISTS "whatsapp_scan_messages_group_id_created_at_idx"
  ON "whatsapp_scan_messages"("group_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_scan_groups_partner_id_fkey'
  ) THEN
    ALTER TABLE "whatsapp_scan_groups"
      ADD CONSTRAINT "whatsapp_scan_groups_partner_id_fkey"
      FOREIGN KEY ("partner_id") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_scan_messages_group_id_fkey'
  ) THEN
    ALTER TABLE "whatsapp_scan_messages"
      ADD CONSTRAINT "whatsapp_scan_messages_group_id_fkey"
      FOREIGN KEY ("group_id") REFERENCES "whatsapp_scan_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
