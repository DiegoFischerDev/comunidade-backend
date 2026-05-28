-- Add next_contact_at to leads for "Próximo contacto" dashboard

ALTER TABLE "leads"
ADD COLUMN IF NOT EXISTS "next_contact_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "leads_partner_id_next_contact_at_idx"
ON "leads"("partner_id", "next_contact_at");

