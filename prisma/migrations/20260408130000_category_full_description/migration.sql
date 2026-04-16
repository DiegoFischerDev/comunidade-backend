-- Add full description for categories (long text shown in hero)
ALTER TABLE "ProductCategory"
ADD COLUMN IF NOT EXISTS "full_description" TEXT;

-- Backfill full_description from existing short description (description)
UPDATE "ProductCategory"
SET "full_description" = COALESCE("full_description", "description")
WHERE "full_description" IS NULL;

