-- CreateTable
CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "support_tickets_user_id_idx" ON "support_tickets"("user_id");
CREATE INDEX IF NOT EXISTS "support_tickets_created_at_idx" ON "support_tickets"("created_at");

-- Foreign key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'support_tickets_user_id_fkey'
  ) THEN
    ALTER TABLE "support_tickets"
    ADD CONSTRAINT "support_tickets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

