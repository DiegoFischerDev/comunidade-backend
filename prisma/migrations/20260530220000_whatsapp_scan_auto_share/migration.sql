ALTER TABLE "whatsapp_scan_groups"
  ADD COLUMN IF NOT EXISTS "auto_share_enabled" BOOLEAN NOT NULL DEFAULT false;
