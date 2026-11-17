-- Boas-vindas configuráveis da Joana (sequência TEXT/AUDIO/IMAGE).
ALTER TABLE "joana_settings" ADD COLUMN "welcome_steps" JSONB NOT NULL DEFAULT '[]';

-- Marca se a sequência (ou intro por omissão) já saiu nesta conversa.
ALTER TABLE "joana_conversations" ADD COLUMN "welcome_sent" BOOLEAN NOT NULL DEFAULT false;
