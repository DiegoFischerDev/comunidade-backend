-- Toggle global dos chatbots por canal (admin /automacao).
ALTER TABLE "chatbot_router_settings"
  ADD COLUMN IF NOT EXISTS "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "instagram_enabled" BOOLEAN NOT NULL DEFAULT true;
