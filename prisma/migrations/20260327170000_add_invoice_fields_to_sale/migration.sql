-- AlterTable
ALTER TABLE "Sale"
ADD COLUMN "wants_invoice" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "invoice_name" TEXT,
ADD COLUMN "invoice_nif" TEXT,
ADD COLUMN "invoice_email" TEXT,
ADD COLUMN "invoice_address" TEXT,
ADD COLUMN "invoice_postal_code" TEXT,
ADD COLUMN "invoice_city" TEXT,
ADD COLUMN "invoice_requested_at" TIMESTAMP(3);

