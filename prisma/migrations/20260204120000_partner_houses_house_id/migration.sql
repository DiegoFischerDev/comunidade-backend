-- Número sequencial único por anúncio (controlo / WhatsApp).
CREATE SEQUENCE IF NOT EXISTS "partner_houses_house_id_seq";

DO $$
BEGIN
  IF to_regclass('public.partner_houses') IS NULL THEN
    -- A tabela é criada numa migration posterior; num DB novo, ela já virá com house_id.
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'partner_houses'
      AND column_name = 'house_id'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE "partner_houses" ADD COLUMN "house_id" INTEGER;

UPDATE "partner_houses" AS ph
SET "house_id" = s.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "created_at" ASC, "id" ASC) AS rn
  FROM "partner_houses"
) AS s
WHERE ph.id = s.id;

SELECT setval(
  'partner_houses_house_id_seq',
  COALESCE((SELECT MAX("house_id") FROM "partner_houses"), 1)
);

ALTER TABLE "partner_houses"
  ALTER COLUMN "house_id" SET DEFAULT nextval('partner_houses_house_id_seq'),
  ALTER COLUMN "house_id" SET NOT NULL;

ALTER SEQUENCE "partner_houses_house_id_seq" OWNED BY "partner_houses"."house_id";

CREATE UNIQUE INDEX "partner_houses_house_id_key" ON "partner_houses"("house_id");
END $$;
