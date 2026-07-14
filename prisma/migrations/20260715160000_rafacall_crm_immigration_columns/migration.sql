-- Renomear IMIGRACAO_MUITO_LONGE → IMIGRACAO_LONGE e adicionar IMIGRACAO_PERTO
CREATE TYPE "RafaCallCrmStatus_new" AS ENUM (
  'ENVIOU_MENSAGEM',
  'IMIGRACAO_LONGE',
  'IMIGRACAO_PERTO',
  'VIDEO_CHAMADA_AGENDADA',
  'REALIZOU_VIDEO_CHAMADA',
  'AGUARDANDO_ASSINATURA',
  'CONTRATO_ASSINADO'
);

ALTER TABLE "rafa_call_bookings"
  ALTER COLUMN "crm_status" DROP DEFAULT;

ALTER TABLE "rafa_call_bookings"
  ALTER COLUMN "crm_status" TYPE "RafaCallCrmStatus_new"
  USING (
    CASE "crm_status"::text
      WHEN 'IMIGRACAO_MUITO_LONGE' THEN 'IMIGRACAO_LONGE'
      ELSE "crm_status"::text
    END::"RafaCallCrmStatus_new"
  );

DROP TYPE "RafaCallCrmStatus";

ALTER TYPE "RafaCallCrmStatus_new" RENAME TO "RafaCallCrmStatus";

ALTER TABLE "rafa_call_bookings"
  ALTER COLUMN "crm_status" SET DEFAULT 'VIDEO_CHAMADA_AGENDADA';
