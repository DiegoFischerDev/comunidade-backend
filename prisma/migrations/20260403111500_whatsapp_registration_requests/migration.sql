-- AlterTable
-- Email passa a ser apenas histórico (opcional)
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- "Indicado por" (código de afiliado, snapshot)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "indicado_por" TEXT;

-- WhatsApp deve ser único
CREATE UNIQUE INDEX IF NOT EXISTS "User_whatsapp_key" ON "User"("whatsapp");

-- Pedido de registo via WhatsApp (criado no /auth/register; vira User após confirmação via Evolution)
CREATE TABLE IF NOT EXISTS "whatsapp_registration_requests" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "affiliate_code_snapshot" TEXT,
  "indicado_por" TEXT,
  "referred_by_affiliate_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "whatsapp_registration_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_registration_requests_code_key"
  ON "whatsapp_registration_requests"("code");

CREATE INDEX IF NOT EXISTS "whatsapp_registration_requests_expires_at_idx"
  ON "whatsapp_registration_requests"("expires_at");

