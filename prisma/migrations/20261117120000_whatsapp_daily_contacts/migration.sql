-- CreateEnum
CREATE TYPE "WhatsappDailyContactReply" AS ENUM ('PENDING', 'SIM', 'NAO');

-- CreateTable
CREATE TABLE "whatsapp_daily_contacts" (
    "id" TEXT NOT NULL,
    "day_key" TEXT NOT NULL,
    "whatsapp_digits" TEXT NOT NULL,
    "instance" TEXT,
    "display_name" VARCHAR(80),
    "first_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "greeted_at" TIMESTAMP(3),
    "reply" "WhatsappDailyContactReply" NOT NULL DEFAULT 'PENDING',
    "replied_at" TIMESTAMP(3),
    "crm_added_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_daily_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_daily_contacts_day_key_first_message_at_idx" ON "whatsapp_daily_contacts"("day_key", "first_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_daily_contacts_day_key_whatsapp_digits_key" ON "whatsapp_daily_contacts"("day_key", "whatsapp_digits");
