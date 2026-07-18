-- CreateEnum
CREATE TYPE "FinanceEntryKind" AS ENUM ('INCOME', 'EXPENSE');

-- AlterTable
ALTER TABLE "rafa_call_crm_payments"
  ADD COLUMN "kind" "FinanceEntryKind" NOT NULL DEFAULT 'INCOME';

-- AlterTable: WhatsApp opcional (despesas / receitas sem cliente)
ALTER TABLE "rafa_call_crm_payments"
  ALTER COLUMN "whatsapp_digits" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "rafa_call_crm_payments_kind_paid_at_idx"
  ON "rafa_call_crm_payments"("kind", "paid_at");
