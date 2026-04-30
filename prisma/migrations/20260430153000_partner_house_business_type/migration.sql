CREATE TYPE "PartnerHouseBusinessType" AS ENUM ('RENT', 'SALE');

ALTER TABLE "partner_houses"
ADD COLUMN "business_type" "PartnerHouseBusinessType" NOT NULL DEFAULT 'RENT';
