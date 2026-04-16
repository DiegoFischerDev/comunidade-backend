-- Partner sales + commission payment via Stripe (idempotent)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerSaleCommissionPaymentStatus') THEN
    CREATE TYPE "PartnerSaleCommissionPaymentStatus" AS ENUM ('PENDING', 'PAID');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "partner_sales" (
  "id" TEXT NOT NULL,
  "partner_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "service_id" TEXT NOT NULL,
  "amount_eur" TEXT NOT NULL,
  "commission_payment_status" "PartnerSaleCommissionPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "commission_suggested_eur" TEXT,
  "commission_paid_eur" TEXT,
  "wants_invoice" BOOLEAN NOT NULL DEFAULT FALSE,
  "invoice_name" TEXT,
  "invoice_nif" TEXT,
  "invoice_address" TEXT,
  "invoice_postal_code" TEXT,
  "invoice_requested_at" TIMESTAMP(3),
  "stripe_checkout_session_id" TEXT,
  "stripe_payment_intent_id" TEXT,
  "paid_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_sales_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "partner_sales_partner_id_idx" ON "partner_sales" ("partner_id");
CREATE INDEX IF NOT EXISTS "partner_sales_user_id_idx" ON "partner_sales" ("user_id");
CREATE INDEX IF NOT EXISTS "partner_sales_service_id_idx" ON "partner_sales" ("service_id");
CREATE INDEX IF NOT EXISTS "partner_sales_commission_payment_status_idx" ON "partner_sales" ("commission_payment_status");

-- Uniques
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'partner_sales_stripe_checkout_session_id_key'
  ) THEN
    CREATE UNIQUE INDEX "partner_sales_stripe_checkout_session_id_key" ON "partner_sales" ("stripe_checkout_session_id");
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'partner_sales_stripe_payment_intent_id_key'
  ) THEN
    CREATE UNIQUE INDEX "partner_sales_stripe_payment_intent_id_key" ON "partner_sales" ("stripe_payment_intent_id");
  END IF;
END$$;

-- Foreign keys (best-effort if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partner_sales_partner_id_fkey'
  ) THEN
    ALTER TABLE "partner_sales"
      ADD CONSTRAINT "partner_sales_partner_id_fkey"
      FOREIGN KEY ("partner_id") REFERENCES "Partner" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partner_sales_user_id_fkey'
  ) THEN
    ALTER TABLE "partner_sales"
      ADD CONSTRAINT "partner_sales_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partner_sales_service_id_fkey'
  ) THEN
    ALTER TABLE "partner_sales"
      ADD CONSTRAINT "partner_sales_service_id_fkey"
      FOREIGN KEY ("service_id") REFERENCES "Service" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

