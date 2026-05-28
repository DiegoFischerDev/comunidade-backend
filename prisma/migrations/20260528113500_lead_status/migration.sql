-- Add status for financing lead follow-up pipeline

-- enum (Postgres)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadGestoraStatus') THEN
    CREATE TYPE "LeadGestoraStatus" AS ENUM (
      'inviavel',
      'pre_aprovado',
      'credito_aprovado',
      'agendado_escritura',
      'escritura_realizada'
    );
  END IF;
END
$$;

ALTER TABLE "leads"
ADD COLUMN IF NOT EXISTS "status" "LeadGestoraStatus";

CREATE INDEX IF NOT EXISTS "leads_partner_id_status_idx"
ON "leads"("partner_id", "status");

