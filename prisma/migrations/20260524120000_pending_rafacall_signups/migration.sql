CREATE TABLE "pending_rafacall_signups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "existing_user_id" TEXT,
    "stripe_session_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_rafacall_signups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_rafacall_signups_stripe_session_id_key" ON "pending_rafacall_signups"("stripe_session_id");

CREATE INDEX "pending_rafacall_signups_whatsapp_idx" ON "pending_rafacall_signups"("whatsapp");

CREATE INDEX "pending_rafacall_signups_expires_at_idx" ON "pending_rafacall_signups"("expires_at");
