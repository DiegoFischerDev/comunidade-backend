-- CreateTable
CREATE TABLE "rafa_call_unlock_payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_checkout_session_id" TEXT,
    "amount_credited_eur" DECIMAL(12,2) NOT NULL,
    "stripe_currency" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rafa_call_unlock_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rafa_call_unlock_payments_stripe_checkout_session_id_key" ON "rafa_call_unlock_payments"("stripe_checkout_session_id");

-- CreateIndex
CREATE INDEX "rafa_call_unlock_payments_user_id_idx" ON "rafa_call_unlock_payments"("user_id");

-- AddForeignKey
ALTER TABLE "rafa_call_unlock_payments" ADD CONSTRAINT "rafa_call_unlock_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
