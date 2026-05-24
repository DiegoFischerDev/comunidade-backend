ALTER TABLE "support_tickets" ALTER COLUMN "user_id" DROP NOT NULL;

ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "guest_name" VARCHAR(120);
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "guest_whatsapp" VARCHAR(32);
