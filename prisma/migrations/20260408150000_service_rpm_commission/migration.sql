-- Add RPM commission field (editable only by admin)
ALTER TABLE "Service"
ADD COLUMN IF NOT EXISTS "rpm_commission_eur" TEXT;

