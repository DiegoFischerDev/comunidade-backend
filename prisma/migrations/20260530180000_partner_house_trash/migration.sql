-- Lixeira de imóveis: novo status TRASH + timestamps para transições automáticas.

ALTER TYPE "PartnerHousePublicationStatus" ADD VALUE IF NOT EXISTS 'TRASH';

ALTER TABLE "partner_houses"
  ADD COLUMN IF NOT EXISTS "hidden_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trashed_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "partner_houses_publication_status_hidden_at_idx"
  ON "partner_houses" ("publication_status", "hidden_at");

CREATE INDEX IF NOT EXISTS "partner_houses_publication_status_trashed_at_idx"
  ON "partner_houses" ("publication_status", "trashed_at");
