-- Whatsapp scan: título do grupo (identificação no painel admin).

ALTER TABLE "whatsapp_scan_groups"
  ADD COLUMN IF NOT EXISTS "title" TEXT;
