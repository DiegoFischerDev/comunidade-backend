-- ============================================================================
-- Migra a feature "categorias" de tabela admin (model `ProductCategory`) para
-- constantes do projeto. Após esta migration, `Partner.category_slug` substitui
-- a FK `Partner.category_id`. Os únicos slugs válidos no app passam a ser:
--   * relocation
--   * financiamento
--   * outras
--
-- A coluna `Service.category_id` é removida porque nunca era preenchida pelo
-- código (dead column).
--
-- Estratégia:
--   1) Adicionar a nova coluna `Partner.category_slug` (TEXT NULL).
--   2) Backfill a partir de `ProductCategory.slug`:
--        - `relocation` e `financiamento` preservam o slug original;
--        - qualquer outro slug (ex.: `abertura-de-conta`) é convertido em
--          `outras` para manter o parceiro categorizado.
--   3) Remover FK + coluna `Partner.category_id`.
--   4) Remover FK + index + coluna `Service.category_id`.
--   5) Apagar a tabela `ProductCategory`.
-- ============================================================================

-- 1) Coluna nova.
ALTER TABLE "Partner" ADD COLUMN "category_slug" TEXT;

-- 2) Backfill: mapeia slug antigo → slug constante novo.
UPDATE "Partner" p
SET "category_slug" = CASE
    WHEN c."slug" IN ('relocation', 'financiamento') THEN c."slug"
    ELSE 'outras'
END
FROM "ProductCategory" c
WHERE p."category_id" = c."id";

-- 3) Remover FK + coluna `Partner.category_id`.
ALTER TABLE "Partner" DROP CONSTRAINT IF EXISTS "Partner_category_id_fkey";
ALTER TABLE "Partner" DROP COLUMN "category_id";

-- 4) Remover FK + index + coluna `Service.category_id`.
ALTER TABLE "Service" DROP CONSTRAINT IF EXISTS "Service_category_id_fkey";
DROP INDEX IF EXISTS "Service_category_id_idx";
ALTER TABLE "Service" DROP COLUMN IF EXISTS "category_id";

-- 5) Apagar tabela `ProductCategory`.
DROP TABLE IF EXISTS "ProductCategory";
