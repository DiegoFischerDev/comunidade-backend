-- CreateTable
CREATE TABLE "membership_payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_checkout_session_id" TEXT,
    "stripe_invoice_id" TEXT,
    "amount_credited_eur" DECIMAL(12,2) NOT NULL,
    "stripe_currency" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "membership_payments_stripe_checkout_session_id_key" ON "membership_payments"("stripe_checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_payments_stripe_invoice_id_key" ON "membership_payments"("stripe_invoice_id");

-- CreateIndex
CREATE INDEX "membership_payments_user_id_idx" ON "membership_payments"("user_id");

-- AddForeignKey
ALTER TABLE "membership_payments" ADD CONSTRAINT "membership_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: um pagamento legado por subscrição existente.
-- Valor 23,00 € é placeholder se não houver histórico real; ajuste em SQL se souber os valores corretos.
INSERT INTO "membership_payments" ("id", "user_id", "stripe_checkout_session_id", "stripe_invoice_id", "amount_credited_eur", "stripe_currency", "created_at")
SELECT
    'mf_backfill_' || "id",
    "user_id",
    NULL,
    NULL,
    23.00,
    'eur',
    "created_at"
FROM "Subscription";
