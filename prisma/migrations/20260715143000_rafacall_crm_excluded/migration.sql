-- AlterTable
ALTER TABLE "rafa_call_bookings"
  ADD COLUMN "crm_excluded_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "rafa_call_bookings_crm_excluded_at_idx" ON "rafa_call_bookings"("crm_excluded_at");
