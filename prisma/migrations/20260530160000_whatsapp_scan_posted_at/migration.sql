-- Whatsapp scan: momento de envio no WhatsApp (messageTimestamp) para correlacionar mídia ao texto.

ALTER TABLE "whatsapp_scan_messages"
  ADD COLUMN IF NOT EXISTS "posted_at" TIMESTAMP(3);

ALTER TABLE "whatsapp_scan_pending_media"
  ADD COLUMN IF NOT EXISTS "posted_at" TIMESTAMP(3);
