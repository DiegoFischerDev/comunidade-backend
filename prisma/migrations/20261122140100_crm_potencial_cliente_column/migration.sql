-- Espelho em crm_columns, entre «Data para imigrar perto» e «Vídeo chamada agendada».
UPDATE "crm_columns"
SET "sort_order" = "sort_order" + 1,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "chatbot_id" = 'chatbot_joana'
  AND "sort_order" >= 3
  AND NOT EXISTS (
    SELECT 1
    FROM "crm_columns" existing
    WHERE existing."chatbot_id" = 'chatbot_joana'
      AND existing."slug" = 'POTENCIAL_CLIENTE'
  );

INSERT INTO "crm_columns" (
  "id",
  "chatbot_id",
  "slug",
  "label",
  "sort_order",
  "tone",
  "pauses_bot",
  "created_at",
  "updated_at"
)
SELECT
  'col_joana_potencial_cliente',
  'chatbot_joana',
  'POTENCIAL_CLIENTE',
  'Cliente ideal',
  3,
  'gold',
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "chatbots" WHERE "id" = 'chatbot_joana')
  AND NOT EXISTS (
    SELECT 1
    FROM "crm_columns"
    WHERE "chatbot_id" = 'chatbot_joana'
      AND "slug" = 'POTENCIAL_CLIENTE'
  );
