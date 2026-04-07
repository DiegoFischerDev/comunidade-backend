-- CreateTable
CREATE TABLE IF NOT EXISTS "rafa_call_blocked_slots" (
    "id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rafa_call_blocked_slots_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "rafa_call_blocked_slots_starts_at_idx" ON "rafa_call_blocked_slots"("starts_at");
CREATE INDEX IF NOT EXISTS "rafa_call_blocked_slots_ends_at_idx" ON "rafa_call_blocked_slots"("ends_at");
CREATE INDEX IF NOT EXISTS "rafa_call_blocked_slots_created_by_user_id_idx" ON "rafa_call_blocked_slots"("created_by_user_id");

-- ForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rafa_call_blocked_slots_created_by_user_id_fkey'
  ) THEN
    ALTER TABLE "rafa_call_blocked_slots"
    ADD CONSTRAINT "rafa_call_blocked_slots_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

