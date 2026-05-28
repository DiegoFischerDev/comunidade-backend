-- Add 6-digit public numeric id for leads (display only)

-- Use a dedicated sequence so we can start at 100000.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'leads_public_id_seq') THEN
    CREATE SEQUENCE "leads_public_id_seq" START 100000;
  END IF;
END
$$;

ALTER TABLE "leads"
ADD COLUMN IF NOT EXISTS "public_id" INTEGER;

-- Backfill existing rows (stable order by created_at + id).
WITH ordered AS (
  SELECT id
  FROM "leads"
  WHERE "public_id" IS NULL
  ORDER BY "created_at" ASC, "id" ASC
)
UPDATE "leads" l
SET "public_id" = nextval('"leads_public_id_seq"')
FROM ordered o
WHERE l.id = o.id;

ALTER TABLE "leads"
ALTER COLUMN "public_id" SET NOT NULL;

ALTER TABLE "leads"
ALTER COLUMN "public_id" SET DEFAULT nextval('"leads_public_id_seq"');

CREATE UNIQUE INDEX IF NOT EXISTS "leads_public_id_key" ON "leads"("public_id");

