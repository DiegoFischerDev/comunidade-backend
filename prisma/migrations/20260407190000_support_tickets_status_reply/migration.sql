-- Enum SupportTicketStatus
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupportTicketStatus') THEN
    CREATE TYPE "SupportTicketStatus" AS ENUM ('REGISTERED', 'IN_REVIEW', 'DONE');
  END IF;
END $$;

-- Columns
ALTER TABLE "support_tickets"
  ADD COLUMN IF NOT EXISTS "status" "SupportTicketStatus" NOT NULL DEFAULT 'REGISTERED';

ALTER TABLE "support_tickets"
  ADD COLUMN IF NOT EXISTS "admin_reply" TEXT;

ALTER TABLE "support_tickets"
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Index
CREATE INDEX IF NOT EXISTS "support_tickets_status_idx" ON "support_tickets"("status");

