CREATE TYPE IF NOT EXISTS "RafaCallBookingStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED');

CREATE TABLE IF NOT EXISTS "rafa_call_bookings" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "status" "RafaCallBookingStatus" NOT NULL DEFAULT 'SCHEDULED',
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "rescheduled_from_booking_id" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "cancel_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rafa_call_bookings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "rafa_call_bookings_user_id_status_idx" ON "rafa_call_bookings"("user_id", "status");
CREATE INDEX IF NOT EXISTS "rafa_call_bookings_starts_at_idx" ON "rafa_call_bookings"("starts_at");
CREATE INDEX IF NOT EXISTS "rafa_call_bookings_ends_at_idx" ON "rafa_call_bookings"("ends_at");

ALTER TABLE "rafa_call_bookings"
  ADD CONSTRAINT "rafa_call_bookings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rafa_call_bookings"
  ADD CONSTRAINT "rafa_call_bookings_rescheduled_from_booking_id_fkey"
  FOREIGN KEY ("rescheduled_from_booking_id") REFERENCES "rafa_call_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

