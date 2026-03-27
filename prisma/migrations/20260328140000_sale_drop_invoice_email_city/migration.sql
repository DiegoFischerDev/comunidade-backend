-- Remove campos redundantes alinhados ao schema atual (foram voltados a adicionar em
-- 20260327170000_add_invoice_fields_to_sale depois da remoção em 20260327115607).
ALTER TABLE "Sale" DROP COLUMN IF EXISTS "invoice_city", DROP COLUMN IF EXISTS "invoice_email";
