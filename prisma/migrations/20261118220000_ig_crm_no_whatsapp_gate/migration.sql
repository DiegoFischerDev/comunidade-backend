-- IG sem pedir WhatsApp: CrmLead pode ancorar em Instagram; WhatsApp deixa de ser único na conversa.
ALTER TABLE "crm_leads"
  ADD COLUMN "instagram_user_id" VARCHAR(64),
  ALTER COLUMN "whatsapp_digits" DROP NOT NULL;

DROP INDEX IF EXISTS "crm_leads_chatbot_id_whatsapp_digits_key";

CREATE UNIQUE INDEX "crm_leads_chatbot_id_instagram_user_id_key"
  ON "crm_leads"("chatbot_id", "instagram_user_id");

CREATE INDEX "crm_leads_chatbot_id_whatsapp_digits_idx"
  ON "crm_leads"("chatbot_id", "whatsapp_digits");

-- Mesmo WhatsApp pode existir em conversas distintas (WA + IG).
DROP INDEX IF EXISTS "joana_conversations_whatsapp_digits_key";

CREATE INDEX "joana_conversations_whatsapp_digits_idx"
  ON "joana_conversations"("whatsapp_digits");
