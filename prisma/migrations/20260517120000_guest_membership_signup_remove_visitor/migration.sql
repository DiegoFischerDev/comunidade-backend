-- Converte utilizadores VISITOR para MEMBER (acesso expirado via membership_expires_at).
UPDATE "users" SET "tier" = 'MEMBER' WHERE "tier" = 'VISITOR';

-- Remove valor VISITOR do enum UserTier.
ALTER TYPE "UserTier" RENAME TO "UserTier_old";
CREATE TYPE "UserTier" AS ENUM ('MEMBER');
ALTER TABLE "users" ALTER COLUMN "tier" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "tier" TYPE "UserTier" USING ('MEMBER'::"UserTier");
ALTER TABLE "users" ALTER COLUMN "tier" SET DEFAULT 'MEMBER';
DROP TYPE "UserTier_old";

CREATE TABLE "pending_membership_signups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "affiliate_code_snapshot" TEXT,
    "indicado_por" TEXT,
    "referred_by_affiliate_id" TEXT,
    "existing_user_id" TEXT,
    "stripe_session_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_membership_signups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_membership_signups_stripe_session_id_key" ON "pending_membership_signups"("stripe_session_id");
CREATE INDEX "pending_membership_signups_whatsapp_idx" ON "pending_membership_signups"("whatsapp");
CREATE INDEX "pending_membership_signups_expires_at_idx" ON "pending_membership_signups"("expires_at");

CREATE TABLE "membership_checkout_handoffs" (
    "id" TEXT NOT NULL,
    "stripe_session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "membership_checkout_handoffs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "membership_checkout_handoffs_stripe_session_id_key" ON "membership_checkout_handoffs"("stripe_session_id");
CREATE INDEX "membership_checkout_handoffs_expires_at_idx" ON "membership_checkout_handoffs"("expires_at");

ALTER TABLE "membership_checkout_handoffs" ADD CONSTRAINT "membership_checkout_handoffs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
