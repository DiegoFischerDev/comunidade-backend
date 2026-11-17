-- Chatbot Joana por cliente do CRM. Off nas colunas pós-chamada já existentes.
ALTER TABLE "rafa_call_bookings" ADD COLUMN "crm_joana_enabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "rafa_call_bookings"
SET "crm_joana_enabled" = false
WHERE "crm_status" IN (
  'REALIZOU_VIDEO_CHAMADA',
  'AGUARDANDO_ASSINATURA',
  'CONTRATO_ASSINADO'
);

-- Trava da conversa quando ainda não há ficha, ou para largar respostas já em fila.
ALTER TABLE "joana_conversations" ADD COLUMN "paused" BOOLEAN NOT NULL DEFAULT false;

UPDATE "joana_conversations" AS c
SET
  "paused" = true,
  "buffer" = '[]'::jsonb,
  "pending_outbound" = NULL,
  "processing" = false
WHERE EXISTS (
  SELECT 1
  FROM "rafa_call_bookings" AS b
  LEFT JOIN "User" AS u ON u."id" = b."user_id"
  WHERE b."crm_joana_enabled" = false
    AND (
      b."guest_whatsapp" = c."whatsapp_digits"
      OR u."whatsapp" = c."whatsapp_digits"
    )
);
