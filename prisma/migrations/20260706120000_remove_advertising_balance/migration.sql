-- Remove saldo de publicidade e ledger (publicação de imóveis passa a ser gratuita)

ALTER TABLE "partner_advertising_ledger_entries" DROP CONSTRAINT IF EXISTS "partner_advertising_ledger_entries_partner_id_fkey";
ALTER TABLE "partner_advertising_ledger_entries" DROP CONSTRAINT IF EXISTS "partner_advertising_ledger_entries_partner_house_id_fkey";

DROP TABLE IF EXISTS "partner_advertising_ledger_entries";

DROP TYPE IF EXISTS "PartnerAdvertisingLedgerType";

ALTER TABLE "Partner" DROP COLUMN IF EXISTS "advertising_balance_eur_cents";
