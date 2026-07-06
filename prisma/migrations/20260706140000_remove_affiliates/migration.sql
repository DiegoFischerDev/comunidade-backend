-- Remover programa de afiliados
-- Nota: tabela real é rafa_call_bookings (@@map), não "RafaCallBooking".

-- Migrar origens legadas de agendamento gratuito via afiliado
UPDATE "rafa_call_bookings" SET "origin" = 'USER_PAID' WHERE "origin" = 'AFFILIATE_FREE';
UPDATE "User" SET "rafa_call_unlock_origin" = 'USER_PAID' WHERE "rafa_call_unlock_origin" = 'AFFILIATE_FREE';

-- Colunas de referência a afiliados (antes de dropar tabelas com FK em "User")
ALTER TABLE "User" DROP COLUMN IF EXISTS "referred_by_affiliate_id";
ALTER TABLE "User" DROP COLUMN IF EXISTS "referred_at";
ALTER TABLE "User" DROP COLUMN IF EXISTS "referred_by_code_snapshot";
ALTER TABLE "User" DROP COLUMN IF EXISTS "indicado_por";

ALTER TABLE "whatsapp_registration_requests" DROP COLUMN IF EXISTS "affiliate_code_snapshot";
ALTER TABLE "whatsapp_registration_requests" DROP COLUMN IF EXISTS "indicado_por";
ALTER TABLE "whatsapp_registration_requests" DROP COLUMN IF EXISTS "referred_by_affiliate_id";

ALTER TABLE "pending_membership_signups" DROP COLUMN IF EXISTS "affiliate_code_snapshot";
ALTER TABLE "pending_membership_signups" DROP COLUMN IF EXISTS "indicado_por";
ALTER TABLE "pending_membership_signups" DROP COLUMN IF EXISTS "referred_by_affiliate_id";

-- Tabelas de afiliados
DROP TABLE IF EXISTS "AffiliateCommission";
DROP TABLE IF EXISTS "AffiliateProfile";

-- Colunas legadas de cashback no User (usavam CashbackPayoutMethod)
ALTER TABLE "User" DROP COLUMN IF EXISTS "cashback_payout_method";
ALTER TABLE "User" DROP COLUMN IF EXISTS "cashback_pix_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "cashback_pix_name";

-- Enum RafaCallBookingOrigin: remover AFFILIATE_FREE
ALTER TYPE "RafaCallBookingOrigin" RENAME TO "RafaCallBookingOrigin_old";
CREATE TYPE "RafaCallBookingOrigin" AS ENUM ('USER_PAID');

ALTER TABLE "rafa_call_bookings" ALTER COLUMN "origin" DROP DEFAULT;
ALTER TABLE "rafa_call_bookings"
  ALTER COLUMN "origin" TYPE "RafaCallBookingOrigin"
  USING ("origin"::text::"RafaCallBookingOrigin");
ALTER TABLE "rafa_call_bookings" ALTER COLUMN "origin" SET DEFAULT 'USER_PAID';

ALTER TABLE "User"
  ALTER COLUMN "rafa_call_unlock_origin" TYPE "RafaCallBookingOrigin"
  USING ("rafa_call_unlock_origin"::text::"RafaCallBookingOrigin");

DROP TYPE "RafaCallBookingOrigin_old";

-- Enums só usados por afiliados
DROP TYPE IF EXISTS "AffiliateCommissionStatus";
DROP TYPE IF EXISTS "AffiliateCommissionCurrency";
DROP TYPE IF EXISTS "CashbackPayoutMethod";
