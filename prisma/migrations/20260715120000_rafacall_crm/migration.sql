-- CreateEnum
CREATE TYPE "RafaCallCrmStatus" AS ENUM (
  'ENVIOU_MENSAGEM',
  'VIDEO_CHAMADA_AGENDADA',
  'REALIZOU_VIDEO_CHAMADA',
  'NAO_TEM_INTERESSE',
  'INTERESSE_FUTURO',
  'AGUARDANDO_ASSINATURA',
  'CONTRATO_ASSINADO'
);

-- AlterTable
ALTER TABLE "rafa_call_bookings"
  ADD COLUMN "crm_status" "RafaCallCrmStatus" NOT NULL DEFAULT 'VIDEO_CHAMADA_AGENDADA',
  ADD COLUMN "crm_comments" TEXT;

-- Backfill: agendamentos já realizados entram na coluna correspondente
UPDATE "rafa_call_bookings"
SET "crm_status" = 'REALIZOU_VIDEO_CHAMADA'
WHERE "status" = 'COMPLETED';

-- CreateIndex
CREATE INDEX "rafa_call_bookings_crm_status_idx" ON "rafa_call_bookings"("crm_status");
