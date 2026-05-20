-- Slug público para URLs curtas (ex.: /maria-silva-a1b2c3). Único por parceiro.
ALTER TABLE "Partner" ADD COLUMN "public_slug" TEXT;

UPDATE "Partner" SET "public_slug" = LEFT(
  TRIM(BOTH '-' FROM REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM("name")), '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g'))
  || '-' || SUBSTRING(MD5("id"::text), 1, 6),
  100
);

UPDATE "Partner" SET "public_slug" = 'parceiro-' || SUBSTRING(MD5("id"::text), 1, 10)
WHERE "public_slug" IS NULL OR TRIM(BOTH '-' FROM "public_slug") = '';

CREATE UNIQUE INDEX "Partner_public_slug_key" ON "Partner"("public_slug");

ALTER TABLE "Partner" ALTER COLUMN "public_slug" SET NOT NULL;
