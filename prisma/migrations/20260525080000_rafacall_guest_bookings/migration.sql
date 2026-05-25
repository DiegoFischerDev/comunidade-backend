-- Permite bookings sem user (fluxo guest).
ALTER TABLE "rafa_call_bookings" ALTER COLUMN "user_id" DROP NOT NULL;

-- Identidade do guest: nome + WhatsApp normalizado (dígitos com indicativo).
ALTER TABLE "rafa_call_bookings"
  ADD COLUMN IF NOT EXISTS "guest_name" TEXT,
  ADD COLUMN IF NOT EXISTS "guest_whatsapp" TEXT;

CREATE INDEX IF NOT EXISTS "rafa_call_bookings_guest_whatsapp_status_idx"
  ON "rafa_call_bookings" ("guest_whatsapp", "status");

-- Tabela de unlocks de pagamento para o fluxo guest.
CREATE TABLE IF NOT EXISTS "rafa_call_guest_unlocks" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "whatsapp" TEXT NOT NULL,
  "stripe_checkout_session_id" TEXT,
  "paid_at" TIMESTAMP(3),
  "consumed_at" TIMESTAMP(3),
  "consumed_booking_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rafa_call_guest_unlocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rafa_call_guest_unlocks_stripe_checkout_session_id_key"
  ON "rafa_call_guest_unlocks" ("stripe_checkout_session_id");

CREATE INDEX IF NOT EXISTS "rafa_call_guest_unlocks_whatsapp_idx"
  ON "rafa_call_guest_unlocks" ("whatsapp");

CREATE INDEX IF NOT EXISTS "rafa_call_guest_unlocks_paid_at_idx"
  ON "rafa_call_guest_unlocks" ("paid_at");
