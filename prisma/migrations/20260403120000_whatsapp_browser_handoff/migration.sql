-- Token opaco no browser para polling após confirmação no WhatsApp
ALTER TABLE "whatsapp_registration_requests"
  ADD COLUMN IF NOT EXISTS "browser_session_token" TEXT;

UPDATE "whatsapp_registration_requests"
SET "browser_session_token" = lower(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
WHERE "browser_session_token" IS NULL;

ALTER TABLE "whatsapp_registration_requests"
  ALTER COLUMN "browser_session_token" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_registration_requests_browser_session_token_key"
  ON "whatsapp_registration_requests"("browser_session_token");

-- Troca única: após criar User, o browser troca este registo por JWT
CREATE TABLE IF NOT EXISTS "whatsapp_registration_browser_handoffs" (
  "id" TEXT NOT NULL,
  "session_token" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),

  CONSTRAINT "whatsapp_registration_browser_handoffs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_registration_browser_handoffs_session_token_key"
  ON "whatsapp_registration_browser_handoffs"("session_token");

CREATE INDEX IF NOT EXISTS "whatsapp_registration_browser_handoffs_expires_at_idx"
  ON "whatsapp_registration_browser_handoffs"("expires_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_registration_browser_handoffs_user_id_fkey'
  ) THEN
    ALTER TABLE "whatsapp_registration_browser_handoffs"
      ADD CONSTRAINT "whatsapp_registration_browser_handoffs_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
