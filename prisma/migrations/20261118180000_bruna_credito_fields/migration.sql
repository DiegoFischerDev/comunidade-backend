-- Bruna: coluna Crédito aprovado após Qualificado; valor da casa pretendida
UPDATE "crm_columns"
SET "sort_order" = 4, "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'col_bruna_encerrado';

INSERT INTO "crm_columns" ("id", "chatbot_id", "slug", "label", "sort_order", "tone", "pauses_bot", "created_at", "updated_at")
VALUES
  ('col_bruna_credito_aprovado', 'chatbot_bruna', 'CREDITO_APROVADO', 'Crédito aprovado', 3, 'amber', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("chatbot_id", "slug") DO NOTHING;

ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "desired_house_value" INTEGER;
