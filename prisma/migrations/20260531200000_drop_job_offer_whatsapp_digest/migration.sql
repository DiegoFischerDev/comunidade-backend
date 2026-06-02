-- Reverte resumo diário WhatsApp: publicação imediata por oferta
DROP INDEX IF EXISTS "job_offers_whatsapp_digest_pending_idx";

ALTER TABLE "job_offers" DROP COLUMN IF EXISTS "whatsapp_digest_sent_at";
ALTER TABLE "job_offers" DROP COLUMN IF EXISTS "whatsapp_digest_dest_group_jid";
ALTER TABLE "job_offers" DROP COLUMN IF EXISTS "whatsapp_digest_day";
