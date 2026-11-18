-- Multi-canal: conversa ancorada em id; WhatsApp e Instagram opcionais.
CREATE TYPE "ChatbotChannel" AS ENUM ('WHATSAPP', 'INSTAGRAM');

ALTER TABLE "joana_conversations"
  ADD COLUMN "instagram_user_id" VARCHAR(64),
  ADD COLUMN "active_channel" "ChatbotChannel" NOT NULL DEFAULT 'WHATSAPP';

ALTER TABLE "joana_conversations"
  ALTER COLUMN "whatsapp_digits" DROP NOT NULL;

CREATE UNIQUE INDEX "joana_conversations_instagram_user_id_key"
  ON "joana_conversations"("instagram_user_id");

CREATE INDEX "joana_conversations_active_channel_idx"
  ON "joana_conversations"("active_channel");
