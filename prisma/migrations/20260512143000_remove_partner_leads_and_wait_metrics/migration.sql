-- Remove armazenamento de leads por parceiro e métricas de tempo de resposta.

DROP TABLE IF EXISTS "processed_partner_lead_messages";

DROP TABLE IF EXISTS "Lead";

ALTER TABLE "Partner" DROP COLUMN IF EXISTS "average_response_minutes";
ALTER TABLE "Partner" DROP COLUMN IF EXISTS "lead_response_sample_count";
ALTER TABLE "Partner" DROP COLUMN IF EXISTS "max_pending_leads";
