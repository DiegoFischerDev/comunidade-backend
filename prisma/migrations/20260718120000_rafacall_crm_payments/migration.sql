-- CreateTable
CREATE TABLE "rafa_call_crm_payments" (
    "id" TEXT NOT NULL,
    "whatsapp_digits" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receipt_image_url" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rafa_call_crm_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rafa_call_crm_payments_whatsapp_digits_paid_at_idx" ON "rafa_call_crm_payments"("whatsapp_digits", "paid_at");
