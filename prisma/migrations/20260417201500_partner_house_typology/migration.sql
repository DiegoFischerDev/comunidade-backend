-- CreateEnum
CREATE TYPE "PartnerHouseTypology" AS ENUM ('T1', 'T2', 'T3', 'T4', 'T5', 'QUARTO_AP_COMPARTILHADO');

-- AlterTable
ALTER TABLE "partner_houses" ADD COLUMN "typology" "PartnerHouseTypology" NOT NULL DEFAULT 'T2';

-- AlterTable (remove default after backfill)
ALTER TABLE "partner_houses" ALTER COLUMN "typology" DROP DEFAULT;
