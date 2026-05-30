-- Whatsapp scan: suporte a mídia (imagens/vídeo) associada aos imóveis

-- Novos estados de mensagem (mídia guardada / anexada).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'WhatsappScanMessageStatus' AND e.enumlabel = 'media_stored'
  ) THEN
    ALTER TYPE "WhatsappScanMessageStatus" ADD VALUE 'media_stored';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'WhatsappScanMessageStatus' AND e.enumlabel = 'media_attached'
  ) THEN
    ALTER TYPE "WhatsappScanMessageStatus" ADD VALUE 'media_attached';
  END IF;
END
$$;

-- Tipo da mídia pendente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WhatsappScanMediaKind') THEN
    CREATE TYPE "WhatsappScanMediaKind" AS ENUM ('IMAGE', 'VIDEO');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "whatsapp_scan_pending_media" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "sender_number" TEXT NOT NULL,
  "kind" "WhatsappScanMediaKind" NOT NULL,
  "stored_url" TEXT NOT NULL,
  "external_message_id" TEXT,
  "message_id" TEXT,
  "consumed_by_house_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_scan_pending_media_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_scan_pending_media_external_message_id_key"
  ON "whatsapp_scan_pending_media"("external_message_id");

CREATE INDEX IF NOT EXISTS "whatsapp_scan_pending_media_group_sender_consumed_created_idx"
  ON "whatsapp_scan_pending_media"("group_id", "sender_number", "consumed_by_house_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_scan_pending_media_group_id_fkey'
  ) THEN
    ALTER TABLE "whatsapp_scan_pending_media"
      ADD CONSTRAINT "whatsapp_scan_pending_media_group_id_fkey"
      FOREIGN KEY ("group_id") REFERENCES "whatsapp_scan_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
