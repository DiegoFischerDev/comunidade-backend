-- Agendamentos públicos gratuitos: origin PUBLIC_FREE + identificador de dispositivo.
ALTER TYPE "RafaCallBookingOrigin" ADD VALUE IF NOT EXISTS 'PUBLIC_FREE';

ALTER TABLE "rafa_call_bookings"
  ADD COLUMN IF NOT EXISTS "client_device_id" TEXT;

CREATE INDEX IF NOT EXISTS "rafa_call_bookings_client_device_id_status_idx"
  ON "rafa_call_bookings" ("client_device_id", "status");
