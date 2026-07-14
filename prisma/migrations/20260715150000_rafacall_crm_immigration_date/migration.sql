-- Recriar enum com a nova coluna e sem os estados removidos
CREATE TYPE "RafaCallCrmStatus_new" AS ENUM (
  'ENVIOU_MENSAGEM',
  'VIDEO_CHAMADA_AGENDADA',
  'REALIZOU_VIDEO_CHAMADA',
  'IMIGRACAO_MUITO_LONGE',
  'AGUARDANDO_ASSINATURA',
  'CONTRATO_ASSINADO'
);

ALTER TABLE "rafa_call_bookings"
  ALTER COLUMN "crm_status" DROP DEFAULT;

ALTER TABLE "rafa_call_bookings"
  ALTER COLUMN "crm_status" TYPE "RafaCallCrmStatus_new"
  USING (
    CASE "crm_status"::text
      WHEN 'NAO_TEM_INTERESSE' THEN 'IMIGRACAO_MUITO_LONGE'
      WHEN 'INTERESSE_FUTURO' THEN 'IMIGRACAO_MUITO_LONGE'
      ELSE "crm_status"::text
    END::"RafaCallCrmStatus_new"
  );

DROP TYPE "RafaCallCrmStatus";

ALTER TYPE "RafaCallCrmStatus_new" RENAME TO "RafaCallCrmStatus";

ALTER TABLE "rafa_call_bookings"
  ALTER COLUMN "crm_status" SET DEFAULT 'VIDEO_CHAMADA_AGENDADA';

ALTER TABLE "rafa_call_bookings"
  ADD COLUMN "crm_expected_immigration_at" TIMESTAMP(3);
