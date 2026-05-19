-- CreateEnum
CREATE TYPE "PartnerHousePublicationStatus" AS ENUM ('PUBLISHED', 'HIDDEN');

CREATE TYPE "PartnerAdvertisingLedgerType" AS ENUM ('STRIPE_TOP_UP', 'ADMIN_CREDIT', 'PUBLICATION_DEBIT');

-- Partner advertising balance (tabela legada: "Partner", não "partners")
ALTER TABLE "Partner" ADD COLUMN "advertising_balance_eur_cents" INTEGER NOT NULL DEFAULT 0;

-- Partner house publication fields
ALTER TABLE "partner_houses" ADD COLUMN "publication_status" "PartnerHousePublicationStatus" NOT NULL DEFAULT 'HIDDEN';
ALTER TABLE "partner_houses" ADD COLUMN "published_until" TIMESTAMP(3);
ALTER TABLE "partner_houses" ADD COLUMN "last_published_at" TIMESTAMP(3);

-- Migrate legacy status: all start HIDDEN (re-publish via new flow)
-- Drop old status column and enum
DROP INDEX IF EXISTS "partner_houses_partner_id_status_idx";
ALTER TABLE "partner_houses" DROP COLUMN IF EXISTS "status";

CREATE INDEX "partner_houses_partner_id_publication_status_idx" ON "partner_houses"("partner_id", "publication_status");
CREATE INDEX "partner_houses_publication_status_published_until_idx" ON "partner_houses"("publication_status", "published_until");

DROP TYPE IF EXISTS "PartnerHouseStatus";

-- Ledger
CREATE TABLE "partner_advertising_ledger_entries" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "type" "PartnerAdvertisingLedgerType" NOT NULL,
    "amount_eur_cents" INTEGER NOT NULL,
    "balance_after_eur_cents" INTEGER NOT NULL,
    "partner_house_id" TEXT,
    "stripe_checkout_session_id" TEXT,
    "admin_user_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_advertising_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_advertising_ledger_entries_stripe_checkout_session_id_key" ON "partner_advertising_ledger_entries"("stripe_checkout_session_id");
CREATE INDEX "partner_advertising_ledger_entries_partner_id_created_at_idx" ON "partner_advertising_ledger_entries"("partner_id", "created_at");

ALTER TABLE "partner_advertising_ledger_entries" ADD CONSTRAINT "partner_advertising_ledger_entries_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partner_advertising_ledger_entries" ADD CONSTRAINT "partner_advertising_ledger_entries_partner_house_id_fkey" FOREIGN KEY ("partner_house_id") REFERENCES "partner_houses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
