-- AlterTable: entrada numérica + taxa relocation obrigatória; remove texto livre "requirements"

ALTER TABLE "partner_houses" ADD COLUMN "caucoes_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "partner_houses" ADD COLUMN "rendas_entrada_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "partner_houses" SET "relocation_fee_eur" = '0' WHERE "relocation_fee_eur" IS NULL;

ALTER TABLE "partner_houses" ALTER COLUMN "relocation_fee_eur" SET NOT NULL;

ALTER TABLE "partner_houses" DROP COLUMN "requirements";
