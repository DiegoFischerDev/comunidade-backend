-- AlterTable: título obrigatório (backfill para lançamentos existentes do CRM)
ALTER TABLE "rafa_call_crm_payments"
  ADD COLUMN "title" TEXT NOT NULL DEFAULT 'Pagamento Relocation';

ALTER TABLE "rafa_call_crm_payments"
  ALTER COLUMN "title" DROP DEFAULT;
